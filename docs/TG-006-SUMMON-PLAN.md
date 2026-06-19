# TG-006 PLANNING DOCUMENT — Summon Subsystem Takeover

**Status:** DRAFT (for next-agent consideration)
**Date:** Session 21
**Author:** Cantrip-z workstream
**Cross-workstream impact:** Core Engine (combat.ts, types/core.ts, planner.ts)

---

## TL;DR — Recommendation

**Yes, take over TG-006 — but in 4 incremental phases, not as one big bang.**

- **Phase 1 (low risk, high coverage):** Implement the 12 TCE `Summon *` spells using hardcoded stat blocks. **12 spells, ~2-3 sessions, LOW risk** — no new engine hooks needed beyond what `spawnSummon` already does.
- **Phase 2 (medium risk):** Implement the 9 PHB `Conjure *` spells using bestiary lookup. **9 spells, ~2 sessions, MEDIUM risk** — needs CR-based creature picker.
- **Phase 3 (low risk):** Implement Find Familiar, Find Steed, Find Greater Steed (3 specific-summon spells). **3 spells, ~1 session, LOW risk** — reuses existing `spawnSummon`.
- **Phase 4 (high risk, defer):** Defer the remaining 19 spells (Animate Dead, Create Undead, Magic Jar, Simulacrum, True Polymorph, etc.) to Core Engine — each needs bespoke subsystems.

Total: **24 of 43 summon blockers (~56%) can be tackled** by Cantrip-z without disrupting Core Engine work. The remaining 19 stay in TEAMGOALS.md.

---

## What I Found — Research Summary

### Existing infrastructure (more than I expected)

The repo ALREADY HAS a summon subsystem skeleton from "Phase 5.1–5.4" (a prior Core Engine initiative):

| File | Lines | Purpose |
|------|-------|---------|
| `src/summons/registry.ts` | 385 | `SUMMON_REGISTRY` — 9 entries (Giant Fly, Avatar of Death, Warhorse, Owl familiar, etc.) with HP formulas, role tags, AI profiles |
| `src/summons/spawner.ts` | 120 | `spawnSummon(rawBestiary, name, options)` — instantiates a Combatant from registry + bestiary, applies HP scaling, tags `isSummon=true` |
| `src/summons/mount.ts` | 179 | `mountCreature`, `syncMountInitiative`, `isControlledMount` — full mount system (PHB p.198) |
| `src/test/summons.test.ts` | — | 51/51 passing — registry lookup, HP resolution, spawn flow, verbal command |

**Key findings:**
1. `spawnSummon()` is fully functional but **NOT called from any spell module** — only `summons.test.ts` and one mount scenario use it.
2. `combat.ts` imports `getSummonEntry` (line 33) but **never uses it** — dead import.
3. The `runCombat` loop in `combat.ts` (lines 2210-2559) iterates `initiative` array. It does NOT support mid-combat insertion of new combatants.
4. `Battlefield.initiativeOrder` is a mutable `string[]` — already supports `push()` / `splice()` for summon insertion.
5. `Combatant` has no `isSummon` field in `core.ts` — `spawner.ts` casts via `(combatant as any).isSummon = true` (line 96), confirming the type system hasn't been told.

### Bestiary coverage

`bestiaryData/bestiary-mm.json` has **450 monsters**, including **51 summonable beasts** (Wolf, Dire Wolf, Panther, Brown Bear, Boar, Constrictor Snake, Giant Spider, etc.) — everything needed for Conjure Animals. CR distribution:

| CR | Count | Notes |
|----|-------|-------|
| 0 | 31 | Baboon, Cat, Owl, etc. (Conjure Animals 8× CR 0) |
| 1/8 | 23 | Giant Rat, Mastiff, etc. (Conjure Animals 8× CR 1/8) |
| 1/4 | 44 | Wolf, Boar, Panther (Conjure Animals 8× or 4× CR 1/4) |
| 1/2 | 39 | Ape, Black Bear, Crocodile (Conjure Animals 4× CR 1/2) |
| 1 | 37 | Brown Bear, Dire Wolf, Giant Spider (Conjure Animals 2× CR 1) |
| 2 | 62 | Conjure Animals 1× CR 2 |

### Blocker spell breakdown (43 summon blockers, not 38 as originally documented)

Re-categorization of TG-006's spell list found **43** spells (the original count of 38 missed 5 due to a regex gap — `Illusory Script`, `Programmed Illusion`, `Leomund's Secret Chest`, `Drawmij's Instant Summons`, `Conjure Constructs` were miscategorized). New breakdown:

| Category | Count | Complexity | Recommendation |
|----------|-------|-----------|----------------|
| TCE `Summon *` (modern stat blocks) | 12 | LOW | **Phase 1 — Cantrip-z implements** |
| PHB `Conjure *` (bestiary lookup) | 9 | MEDIUM | **Phase 2 — Cantrip-z implements** |
| Find Familiar / Find Steed / Find Greater Steed | 3 | LOW | **Phase 3 — Cantrip-z implements** |
| Animate Dead / Create Undead / Create Magen | 3 | HIGH | Defer to Core Engine |
| Planar Ally / Planar Binding / Gate / Infernal Calling | 4 | HIGH | Defer to Core Engine |
| Magic Jar / Clone / Simulacrum / True Polymorph / Shapechange | 5 | VERY HIGH | Defer to Core Engine |
| Other (Glyph of Warding, Symbol, Programmed Illusion, etc.) | 7 | VARIES | Defer to Core Engine |
| **TOTAL** | **43** | | **24 implementable, 19 deferred** |

### Core Engine activity check

Reviewed `HANDOVER-SESSION-39.md` through `HANDOVER-SESSION-44.md`. **Core Engine has NOT mentioned summons in any recent handover.** Their current focus (Session 44): migrating level-1 spells from `spellHealPlan` to dedicated modules (just finished Healing Word). Their TASK.md acceptance criteria (Shield, Guiding Bolt, Healing Word) are all complete; no new summon objective is visible. **Low risk of work conflict.**

---

## Architecture — What's Already There vs What's Missing

### Already there (do NOT rebuild)

- ✅ `SummonEntry` interface with role/source/HP-formula fields (`registry.ts`)
- ✅ `SUMMON_REGISTRY` with 9 entries — Giant Fly, Avatar of Death, Warhorse, Giant Eagle, Hippogriff, Riding Horse, Mule, Camel, Owl, Cat
- ✅ `spawnSummon(rawBestiary, name, options)` — instantiates a Combatant
- ✅ `issueVerbalCommand(bf, summonId, profile)` — sets `bf.pendingCommands`
- ✅ Mount system (`mount.ts`) — mount/dismount, controlled/independent, initiative sync
- ✅ `runCombat` reads `bf.pendingCommands` and switches AI profile at start of summon's turn (combat.ts line 2332)
- ✅ `startConcentration` / `breakConcentration` / `removeEffectsFromCaster` for concentration-bound summons
- ✅ Bestiary data for CR-based summoning (450 monsters, 51 beasts)

### Missing (must build)

1. **`SummonState` tracking on `Battlefield`** — need to know which summons belong to which caster, so when the caster's concentration breaks, the summon disappears. Currently `Combatant` has no `isSummon` field; `spawnSummon` casts via `as any`.

2. **Mid-combat insertion into `initiativeOrder`** — TCE Summon spells: "shares your initiative count, but it takes its turn immediately after yours". PHB Conjure spells: "Roll initiative for the summoned creatures as a group". Both need a hook in `runCombat` to splice new IDs into the initiative array.

3. **Concentration-break despawn hook** — when `removeEffectsFromCaster(casterId, bf)` is called, it should also remove all summons whose `summonerId === casterId` from `bf.combatants` and `bf.initiativeOrder`.

4. **TCE Summon stat blocks** — the 12 TCE spells (Summon Beast, Summon Fey, Summon Undead, Summon Shadowspawn, Summon Aberration, Summon Construct, Summon Elemental, Summon Celestial, Summon Draconic Spirit, Summon Fiend, Summon Lesser Demons, Summon Greater Demon) use **inline stat blocks that scale with slot level**. These stat blocks are NOT in the bestiary — they need to be hardcoded in spell modules or in `SUMMON_REGISTRY`.

5. **CR-based picker for Conjure spells** — given a target CR and creature type (beast/fey/elemental), pick N creatures from the bestiary. Need a `pickCreaturesByCR(bestiary, cr, type, count)` helper.

6. **Planner integration** — the AI needs to know when to cast a summon spell. Add planner branches that call `shouldCastSummonBeast` etc. and produce `PlannedAction.type === 'summonSpell'` (or use the existing `'genericSpell'` dispatch with a `spellName`).

---

## Proposed Design — SummonState Shape

### Type changes (`src/types/core.ts`)

```typescript
// Add to Combatant interface:
export interface Combatant {
  // ...existing fields...
  
  // ── Session 21 — Summon subsystem (TG-006) ──────────────────
  /** True if this combatant was spawned by a Summon/Conjure spell.
   *  Set by spawnSummon() — used by removeEffectsFromCaster to despawn. */
  isSummon?: boolean;
  
  /** The ID of the combatant who summoned this creature.
   *  Used for: (a) concentration-break despawn, (b) faction inheritance. */
  summonerId?: string;
  
  /** The spell name that created this summon (e.g. 'Summon Beast').
   *  Used for logging and cleanup identification. */
  summonSpellName?: string;
}

// Add to Battlefield interface:
export interface Battlefield {
  // ...existing fields...
  
  /** Combatant IDs that were added mid-combat (summons, animate dead, etc.).
   *  The runCombat loop checks this after each actor's turn to splice new
   *  IDs into initiativeOrder at the correct position. */
  pendingInitiativeInserts?: Array<{
    combatantId: string;
    insertAfterId: string;   // for TCE-style "after caster"
    groupKey?: string;       // for PHB-style "roll as a group" (same key = same init)
    initiativeRoll?: number; // for PHB-style group initiative
  }>;
}
```

### Type changes (additions to `PlannedAction.type` union)

Either:
- (a) **Reuse `'genericSpell'`** with `spellName: 'Summon Beast'` — simplest, but the spell module needs a different `execute` signature (it must spawn a combatant, not just set a flag). This breaks the uniform `execute(caster, state)` shape of all 313 existing generic spells.
- (b) **Add a new `'summonSpell'` type** — cleaner, but requires a new case branch in `combat.ts` and a new planner branch.

**Recommendation: option (b)**. Add `'summonSpell'` to `PlannedAction.type`. The case branch in `combat.ts` will call `executeSummonSpell(caster, plan, state, bf)` which dispatches via a new `SUMMON_SPELL_REGISTRY` keyed by spell name.

### Engine integration (`src/engine/combat.ts`)

Add 3 hooks to `runCombat`:

```typescript
// Hook 1: After each actor's turn, splice pending summons into initiativeOrder
// (TCE: after caster; PHB: at end of round with group initiative)
for (const insert of battlefield.pendingInitiativeInserts ?? []) {
  if (insert.insertAfterId === actorId) {
    const idx = battlefield.initiativeOrder.indexOf(insert.combatantId);
    if (idx === -1) {
      // New summon — insert
      const afterIdx = battlefield.initiativeOrder.indexOf(insert.insertAfterId);
      battlefield.initiativeOrder.splice(afterIdx + 1, 0, insert.combatantId);
    }
  }
}

// Hook 2: When removeEffectsFromCaster is called, also despawn its summons
// (modify removeEffectsFromCaster in spell_effects.ts OR add a wrapper)
export function removeEffectsFromCaster(casterId: string, bf: Battlefield): void {
  // ...existing effect cleanup...
  
  // Session 21 — despawn summons (TG-006)
  const summons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === casterId
  );
  for (const summon of summons) {
    bf.combatants.delete(summon.id);
    const idx = bf.initiativeOrder.indexOf(summon.id);
    if (idx !== -1) bf.initiativeOrder.splice(idx, 1);
    // Log the despawn
  }
}

// Hook 3: Add case 'summonSpell' in executePlannedAction
case 'summonSpell': {
  const spellName = plan.spellName;
  if (!spellName) break;
  const desc = lookupSummonSpell(spellName);
  if (!desc) break;
  if (desc.shouldCast(actor, bf)) {
    desc.execute(actor, state, bf);
  }
  break;
}
```

### Spell module shape (TCE Summon Beast example)

```typescript
// src/spells/summon_beast.ts
export const metadata = {
  name: 'Summon Beast',
  level: 2,
  school: 'conjuration',
  rangeFt: 90,
  concentration: true,
  castingTime: 'action',
} as const;

export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Summon Beast')) return false;
  if (!hasSpellSlot(caster, 2)) return false;
  if (caster.concentration?.active) return false; // Summon Beast is concentration
  // Could also check: space available within 90 ft, beast-type enemy present, etc.
  return true;
}

export function execute(caster: Combatant, state: EngineState, bf: Battlefield): void {
  consumeSpellSlot(caster, 2);
  startConcentration(caster, 'Summon Beast');
  
  // Pick environment (v1: always 'Land' — could be parameterized)
  // Pick beast stat block by slot level (v1: always 2nd-level stat block)
  const beastStatBlock = BESTIAL_SPIRIT_STAT_BLOCK_LAND_L2;
  
  // Spawn the beast
  const spawnPos = findFreeAdjacentSquare(caster.pos, bf);
  if (!spawnPos) {
    // No space — spell fails (PHB: "manifests in an unoccupied space")
    log(state, 'action', caster.id, `${caster.name} casts Summon Beast but no space!`);
    return;
  }
  
  const beast = instantiateStatBlock(beastStatBlock, spawnPos, caster);
  beast.isSummon = true;
  beast.summonerId = caster.id;
  beast.summonSpellName = 'Summon Beast';
  beast.faction = caster.faction;
  beast.aiProfile = 'attackNearest';
  
  bf.combatants.set(beast.id, beast);
  
  // Queue initiative insert — TCE: "immediately after yours"
  if (!bf.pendingInitiativeInserts) bf.pendingInitiativeInserts = [];
  bf.pendingInitiativeInserts.push({
    combatantId: beast.id,
    insertAfterId: caster.id,
  });
  
  log(state, 'action', caster.id,
    `${caster.name} casts Summon Beast! A Bestial Spirit appears at (${spawnPos.x},${spawnPos.y}).`,
    beast.id);
}

export function cleanup(_c: Combatant): void { /* no-op */ }
```

### Bestial Spirit stat block (hardcoded)

TCE p.111 provides a unified stat block that scales by level. For v1, hardcode the L2 version:

```typescript
const BESTIAL_SPIRIT_STAT_BLOCK_LAND_L2 = {
  name: 'Bestial Spirit',
  hp: 20,         // 2d10+8 (CON mod +4, level 2)
  ac: 12,         // 12 + PB
  speed: 30,
  str: 14, dex: 14, con: 12, int: 4, wis: 10, cha: 6,
  actions: [{
    name: 'Maul',
    isMultiattack: false,
    attackType: 'melee' as const,
    reach: 5,
    range: null,
    hitBonus: 5,  // PB + STR mod
    damage: { count: 1, sides: 8, bonus: 2, average: 6 },  // 1d8+2 slashing
    damageType: 'slashing' as const,
    // ...
  }],
};
```

---

## Phasing — Detailed Plan

### Phase 1: TCE Summon Spells (12 spells, LOW risk)

**Spells:** Summon Beast (L2), Summon Fey (L3), Summon Lesser Demons (L3), Summon Shadowspawn (L3), Summon Undead (L3), Summon Aberration (L4), Summon Construct (L4), Summon Elemental (L4), Summon Greater Demon (L4), Summon Celestial (L5), Summon Draconic Spirit (L5), Summon Fiend (L6).

**Why LOW risk:** Each spell uses a single hardcoded stat block (TCE provides them inline). No bestiary lookup. No CR-based picker. All spells share the same `execute` shape — only the stat block differs.

**Sub-tasks:**
1. Add `isSummon`, `summonerId`, `summonSpellName` fields to `Combatant` (3 fields, additive).
2. Add `pendingInitiativeInserts` field to `Battlefield` (1 field, additive).
3. Add `'summonSpell'` to `PlannedAction.type` union (1 type, additive).
4. Add `case 'summonSpell':` branch in `combat.ts` (1 case branch, additive).
5. Add `findFreeAdjacentSquare(pos, bf)` helper to `movement.ts` (new helper, additive).
6. Add mid-turn initiative-insert hook in `runCombat` (5 lines, additive).
7. Extend `removeEffectsFromCaster` to despawn summons (5 lines, additive).
8. Hardcode 12 stat blocks (TCE: Bestial Spirit, Fey Spirit, etc.) — 1 file per spell, ~150 lines each.
9. Add 12 `SUMMON_SPELL_REGISTRY` entries (similar to `_generic_registry.ts`).
10. Add 12 planner branches (mirror existing pattern, or extend the generic loop).
11. Write 12 test files (mirror `summons.test.ts` pattern).

**Sessions:** 2-3 (4 spells per session).

### Phase 2: PHB Conjure Spells (9 spells, MEDIUM risk)

**Spells:** Conjure Animals (L3), Conjure Barrage (L3 — actually a damage spell, not a summon!), Conjure Constructs (L3), Conjure Minor Elementals (L4), Conjure Woodland Beings (L4), Conjure Elemental (L5), Conjure Volley (L5 — also a damage spell!), Conjure Fey (L6), Conjure Celestial (L7).

**Wait — `Conjure Barrage` and `Conjure Volley` are NOT actually summon spells.** They're damage spells that "conjure" ammunition/missiles. They should be re-categorized as non-blocker combat spells and added to the generic registry instead. That reduces Phase 2 to **7 actual summon spells**.

**Why MEDIUM risk:** PHB Conjure spells use the bestiary, not hardcoded stat blocks. Need a CR-based picker. Need to handle "8× CR 1/4" vs "4× CR 1/2" vs "2× CR 1" count/CR tradeoff (caster chooses). Need to roll group initiative.

**Sub-tasks (in addition to Phase 1):**
1. Add `pickCreaturesByCR(bestiary, maxCR, type, count)` helper to `summons/registry.ts`.
2. Add group-initiative roll helper (initiativeRoll field on pendingInitiativeInserts).
3. Add 7 spell modules with the same execute shape as Phase 1 but with bestiary lookup instead of hardcoded stat block.
4. Add 7 planner branches.
5. Write 7 test files.

**Sessions:** 1-2 (4 spells per session).

### Phase 3: Find Familiar / Find Steed / Find Greater Steed (3 spells, LOW risk)

**Spells:** Find Familiar (L1), Find Steed (L2), Find Greater Steed (L4).

**Why LOW risk:** These are 1-summon-per-cast spells with specific stat blocks (Owl/Cat/etc. for familiar, Mount for steed). The `spawnSummon` function ALREADY supports this — just wire up the spell modules. The existing `SUMMON_REGISTRY` already has Owl/Cat/Warhorse entries.

**Special considerations:**
- **Find Familiar**: familiar cannot attack (PHB p.240). Set `cannotAttack: true` and use Help action. The `SUMMON_REGISTRY` already tags Owl/Cat with `canAttack: false` and `role: 'familiar'`.
- **Find Steed**: mount with intelligence 6, shares spells with rider. Treat as a `combat_mount` (already in `SUMMON_REGISTRY` as Warhorse? no — Find Steed summons a spectral mount with custom stat block).
- **Find Greater Steed**: same but flying (Pegasus, Griffon, etc.).

**Sessions:** 1.

### Phase 4: Defer to Core Engine (19 spells, HIGH/VERY HIGH risk)

**Spells:** Animate Dead, Create Undead, Create Magen, Planar Ally, Planar Binding, Gate, Infernal Calling, Magic Jar, Clone, Simulacrum, True Polymorph, Shapechange, Glyph of Warding, Symbol, Programmed Illusion, Illusory Script, Leomund's Secret Chest, Drawmij's Instant Summons, Demiplane.

**Why defer:** Each requires a bespoke subsystem that touches Core Engine files in non-trivial ways:
- Animate Dead / Create Undead need a persistent-undead-tracking system (the undead persist across combats until destroyed — outside combat scope).
- Magic Jar / Clone / Simulacrum need body-swap / duplicate-caster subsystems.
- True Polymorph / Shapechange need runtime stat-block replacement (change `Combatant.actions`, `Combatant.maxHP`, `Combatant.str`, etc. mid-combat).
- Glyph of Warding / Symbol need a "spell stored in a location" subsystem with trigger conditions.
- Programmed Illusion / Illusory Script need an illusion subsystem (overlaps with TG-005).
- Demiplane / Leomund's Secret Chest / Drawmij's Instant Summons need a "pocket dimension / item storage" subsystem.

These all warrant their own TG entries (or expansions of TG-011 Complex Mechanics).

---

## Cross-Workstream Touchpoints — Coordination Checklist

Before starting Phase 1, post this checklist as an RFC in `TEAMGOALS.md`:

### Files I (Cantrip-z) will modify

| File | Change | Risk to Core Engine |
|------|--------|---------------------|
| `src/types/core.ts` | Add `isSummon?`, `summonerId?`, `summonSpellName?` to `Combatant`; add `pendingInitiativeInserts?` to `Battlefield`; add `'summonSpell'` to `PlannedAction.type` | LOW — all additive, optional fields |
| `src/engine/combat.ts` | Add `case 'summonSpell':` branch; add mid-turn initiative-insert hook in `runCombat` | MEDIUM — touches `runCombat`'s main loop |
| `src/engine/spell_effects.ts` | Extend `removeEffectsFromCaster` to despawn summons | LOW — additive, doesn't change existing behavior |
| `src/engine/movement.ts` | Add `findFreeAdjacentSquare(pos, bf)` helper | LOW — additive |
| `src/summons/registry.ts` | Add 12 TCE stat block entries (Phase 1) + CR picker (Phase 2) | LOW — additive |
| `src/spells/summon_*.ts` | New spell modules | LOW — new files |
| `src/spells/_summon_registry.ts` | New dispatch registry (mirror `_generic_registry.ts`) | LOW — new file |
| `src/ai/planner.ts` | Add summon-spell planner branch (mirror generic loop) | LOW — additive |
| `src/data/spells.ts` | Add `SPELL_DB` entries for the 22 spells | LOW — additive |
| `src/test/summon_*.test.ts` | New test files | LOW — new files |

### Files Core Engine owns that I will NOT touch

- `src/parser/fivetools.ts` (monsterToCombatant) — I'll call it as-is.
- `src/engine/utils.ts` (startConcentration, resetBudget) — call as-is.
- `src/ai/resources.ts` (hasSpellSlot, consumeSpellSlot) — call as-is.
- `src/engine/los.ts` — no LOS changes for summons.

### Conflict scenarios

1. **Core Engine adds a new concentration spell** → uses `removeEffectsFromCaster` → my summon-despawn extension fires. **Safe** — additive, no behavior change for non-summon casters.
2. **Core Engine refactors `runCombat` loop** → my initiative-insert hook needs to live in the new structure. **Coordinate** — flag in `TEAMGOALS.md` before refactor.
3. **Core Engine adds their own summon spell** → uses my `case 'summonSpell':` branch. **Safe** — they import my dispatch.
4. **Core Engine changes `Combatant` shape** → my additive fields are untouched. **Safe** — optional fields default to undefined.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `runCombat` loop change breaks insert hook | LOW | HIGH | Keep hook as small as possible (5 lines), document well, add tests |
| Stat block hardcoded at wrong value (TCE) | MEDIUM | LOW | Test against published stat blocks; flag uncertainty in metadata |
| Bestiary missing creature for Conjure (Phase 2) | LOW | MEDIUM | Verify bestiary coverage before Phase 2; fall back to closest CR if exact match missing |
| Concentration-break despawn fires in wrong order | LOW | MEDIUM | Test: cast Summon Beast, take damage, lose concentration → verify summon disappears |
| Initiative order gets corrupted by insert/splice | MEDIUM | HIGH | Test: cast 3 summons in same round, verify all 3 take turns in correct order |
| Find Familiar cannot attack — but AI tries to attack | MEDIUM | LOW | Set `cannotAttack: true` on familiar Combatants; AI planner already handles this flag |
| Summon faction inherits wrong faction | LOW | HIGH | Test: party caster summons beast → beast is party faction, attacks enemy faction |

---

## Estimated Effort

| Phase | Spells | New LOC (rough) | Sessions | Risk |
|-------|--------|-----------------|----------|------|
| 1 — TCE Summon | 12 | ~2000 (12 modules × ~150 LOC + 200 LOC infra) | 2-3 | LOW |
| 2 — PHB Conjure | 7 | ~1200 (7 modules × ~150 LOC + 150 LOC CR picker) | 1-2 | MEDIUM |
| 3 — Find Familiar / Steed | 3 | ~450 (3 modules × ~150 LOC) | 1 | LOW |
| 4 — Deferred | 19 | N/A | N/A | HIGH |
| **TOTAL** | **22 implementable** | **~3650 LOC** | **4-6 sessions** | |

---

## Recommendation to Next Agent

1. **Start Phase 1 in Session 22.** Implement the infrastructure (type changes, combat.ts hook, spell_effects.ts extension) AND the first 3 TCE spells (Summon Beast L2, Summon Fey L3, Summon Undead L3) as a vertical slice.
2. **Post an RFC in TEAMGOALS.md** before touching `combat.ts` `runCombat` loop — give Core Engine 1 session to object.
3. **Re-categorize Conjure Barrage and Conjure Volley** — they're damage spells, not summons. Move them to the generic registry (Session 19 pattern) immediately.
4. **Update TG-006's spell count** from 38 to 43 (5 missed spells) and split into Phase 1/2/3/4 with the breakdown above.
5. **Defer Phase 4 entirely** — split those 19 spells into individual TG entries under TG-011 (Complex Mechanics) or create new TG-012..TG-030 entries. Don't try to tackle them.

---

## Open Questions (for next agent or Core Engine)

1. **Should summons be tracked in `Combatant.activeEffects` (as a pseudo-effect) or as a separate `Battlefield.summons` array?** I lean toward the latter (cleaner separation), but Core Engine may prefer the former (single cleanup path).
2. **Should TCE stat blocks live in `src/spells/summon_beast.ts` (per-spell) or in `src/summons/stat_blocks.ts` (centralized)?** I lean toward per-spell (matches the existing pattern), but a centralized file would be easier to update if TCE errata changes.
3. **Should the AI planner prefer summon spells over damage spells?** A Summon Beast (L2) deals ~6 dmg/round for 10 rounds = 60 dmg total vs Scorching Ray (L2) deals ~21 dmg once. The planner's current heuristic is single-turn damage, so it would always prefer Scorching Ray. Need a multi-turn damage model — out of scope for Phase 1, but flag for TG-003 (AI planner cantrip selection — same problem).
4. **What happens if a summon is on the battlefield when combat ends?** v1 simplification: despawn all summons at combat end (they're concentration-bound and concentration ends when combat ends). Document this.
5. **Find Familiar: should the familiar be summonable in EVERY combat, or once per long rest?** PHB p.240: "When you cast this spell, you can decide the form the familiar takes... you can use your action to touch the familiar and spend 10 minutes to cast this spell again to change its form." This suggests familiars persist across combats. v1 simplification: summon at start of each combat (mirror Aid's "persists for combat" pattern). Document this.
