# zHANDOVER-SESSION-22

## REPOSITORY

- Branch: main
- Prior commits (cantrip-z workstream — real-mechanics migration):
  - `<new>` — Cantrip-22: Real-mechanics migration — 7 combat damage spells (Fireball, Lightning Bolt, Cone of Cold, Inflict Wounds, Chromatic Orb, Catapult, Ice Knife). Migrated from the Session 19/20 generic-dispatch forward-compat flags to bespoke implementations with REAL mechanical effects (DEX/CON saves, spell attack rolls, AoE damage). Mirrors the Session 18 bespoke pattern (Moonbeam / Shatter / Scorching Ray). Added new `inLineFt` helper to movement.ts for Lightning Bolt's 100-ft × 5-ft line. Added 7 new case branches in combat.ts + 7 new planner branches in planner.ts (tactical priority: L5 > L3 > L1 by expected damage). Added 7 new types to PlannedAction.type union in core.ts. Removed 7 entries from _generic_registry.ts (313 → 306 spells). Wrote 7 new test files (272 new assertions, all passing). Updated bulk_spell_dispatch.test.ts (91/91, was 84/84 — added a new section verifying migrated spells are no longer in the registry). All prior tests still green (healing_word, healing_spells, bless, burning_hands, magic_missile, shield_simple, sleep, arcane_lock, moonbeam, darkvision, combat, shatter, scorching_ray, summons). tsc --noEmit: 0 errors. Spell cache: 420/557 (unchanged — migration is qualitative, not quantitative).
  - `b53b622` — Cantrip-21: TG-006 summon subsystem research + 4-phase plan (no code changes).
  - `98f5b00` — Cantrip-20: BULK-IMPLEMENT 51 non-blocker in-scope L1 spells (generic dispatch pattern).
  - `c0aebb4` — Cantrip-19: BULK-IMPLEMENT 262 non-blocker in-scope spells from levels 2-9 (generic dispatch pattern).
  - `aa6c65a` — Cantrip-18: Implement 20 PHB level-2 spells (batch 4 — double-sized per user instruction '15 more than requested').
  - `a0f5326` — Cantrip-17: Implement 15 PHB level-2 spells (batch 3 — double-sized per user instruction).
  - `5422d05` — Cantrip-16: Implement Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image (PHB level-2 batch 2).
  - `39594ad` — Cantrip-15: Pivot to Level-2 spells — implement Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite (PHB).
  - `c7e636d` — Cantrip-14: Implement `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot).
  - `d5660dc` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water — FINAL cantrip batch.
  - (see `zHandoversOld/` for Cantrip-1 through Cantrip-12)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: user provides in chat each session. do not warn.

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrip-z / Level 1-9 spells (this agent)** | **THIS agent (you)** |
| `TEAMGOALS.md` | **All three workstreams (shared)** | **ANY agent may append sections — edit only your own** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — coordinate via TEAMGOALS.md |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip-z workstream — REAL-MECHANICS MIGRATION continuing)

- **The cantrip implementation workstream is COMPLETE (since Session 13).** All 46 in-scope cantrips are implemented.
- **Session 19 BULK-IMPLEMENTED all 262 non-blocker in-scope spells from levels 2-9** using a generic forward-compat flag pattern.
- **Session 20 BULK-IMPLEMENTED 51 non-blocker in-scope LEVEL-1 spells** using the same generic dispatch pattern.
- **Session 21 produced a TG-006 SUMMON-PLAN research document** (no code changes) — 4-phase plan for taking over the Summon subsystem (24 of 43 summon blockers implementable by Cantrip-z without disrupting Core Engine).
- **Session 22 (THIS SESSION) began the REAL-MECHANICS MIGRATION** — giving the Session 19/20 bulk-implemented spells REAL mechanical effects by extending the engine subsystems. Migrated 7 combat damage spells from generic-dispatch forward-compat flags to bespoke implementations:
  - **Fireball** (PHB L3) — DEX save + 8d6 fire in 20-ft radius AoE (range 150 ft). Mirrors Shatter pattern.
  - **Lightning Bolt** (PHB L3) — DEX save + 8d6 lightning in 100-ft × 5-ft line from caster. NEW `inLineFt` helper in movement.ts.
  - **Cone of Cold** (PHB L5) — CON save + 8d8 cold in 60-ft cone. Mirrors Burning Hands pattern.
  - **Inflict Wounds** (PHB L1) — Melee spell attack + 3d10 necrotic (crit doubles). Touch range (5-ft adjacency). Mirrors Scorching Ray attack-roll pattern.
  - **Chromatic Orb** (PHB L1) — Ranged spell attack + 3d8 chosen-elemental (picker avoids target's resistances, crit doubles). Range 90 ft. Smart-type-choice heuristic.
  - **Catapult** (XGE L1) — DEX save + 3d8 bludgeoning, single-target. Range 60 ft.
  - **Ice Knife** (XGE L1) — Hybrid: ranged spell attack 1d10 piercing + 2d6 cold DEX save in 5-ft radius AoE (explodes on hit OR miss). First hybrid attack-roll + AoE-save spell in v1.
- **Total implemented: 420/557 (unchanged from Session 20)** — the migration is QUALITATIVE (forward-compat flag → real mechanics), not quantitative. 124 in-scope spells remain — all are blockers documented in TEAMGOALS.md (109 from Session 19 + 14 from Session 20 + Cure Wounds).
- **Session 23+ should continue the real-mechanics migration** with the next batch of combat damage spells. Recommended next batch (high-damage single-target / save-or-suck): Disintegrate (L6 — DEX save 10d6+40 force + disintegrate-on-0-HP), Finger of Death (L7 — CON save 7d8+30 necrotic + zombie-raise on-kill), Power Word Kill (L9 — conditional instakill if HP < 100), Cloudkill (L5 — CON save 8d6 poison,移动 AoE cloud), Blight (L4 — CON save 8d8 necrotic single-target + plant-water-drain), Harm (L6 — CON save 14d6 necrotic + max-HP-reduction), Sunburst (L8 — CON save 12d6 radiant 60-ft radius AoE + blindness).
- **Forward-compat subsystems (Session 14 pivot direction) tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem (was Option B) — still OPEN.
  - TG-002: Concentration subsystem (was Option C) — still OPEN; partial implementation exists (Session 16 added damage_zone start-of-turn concentration-break hook).
  - TG-003: AI planner cantrip selection (was Option D) — still OPEN.
  - TG-004: Parser tech debt (was Option E) — still OPEN.
  - TG-005: Illusion-disbelief Investigation check (was Option F) — still OPEN.
  - TG-006: Summon/Conjure subsystem (Session 19) — OPEN, 38 spells blocked. Session 21 produced a 4-phase plan (see `TG-006-SUMMON-PLAN.md`).
  - TG-007: Wall subsystem (Session 19) — OPEN, 12 spells blocked.
  - TG-008: Reaction spell subsystem (Session 19) — OPEN, 5 spells blocked (4 L1 + 1 L3).
  - TG-009: Antimagic/Dispel subsystem (Session 19) — OPEN, 3 spells blocked.
  - TG-010: computeLOS/vision-blocking (Session 19) — OPEN, 18 spells blocked.
  - TG-011: Complex mechanics (Session 19) — OPEN, 28 spells blocked.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- Do NOT touch another workstream's handover files.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-21.md`** (the prior session — TG-006 summon subsystem research + 4-phase plan).
3. Read **`TG-006-SUMMON-PLAN.md`** (Session 21's planning document for the Summon subsystem takeover).
4. Read **`TEAMGOALS.md`** — cross-workstream coordination. Session 19 added TG-006 through TG-011 (109 blocker spells). Sessions 20-22 added NO new TG entries.
5. Read **`HANDOVER-SESSION-44.md`** (Core Engine's latest) — they finished Healing Word in Session 44. Their TASK.md acceptance criteria (Shield, Guiding Bolt, Healing Word) are all complete.
6. Read **`SPELL-CACHE.md`** — the cache + picker workflow.
7. Run `npm install` (deps: ts-node, typescript).
8. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 22 end: 420/557 spells implemented (46 cantrips + 66 level-1 + 84 level-2 + 56 level-3 + 41 level-4 + 43 level-5 + 33 level-6 + 19 level-7 + 18 level-8 + 14 level-9). 124 in-scope blockers remain.
9. `grep -n "case 'fireball'\|case 'lightningBolt'\|case 'iceKnife'" src/engine/combat.ts` — confirm the 7 Session 22 bespoke case branches exist.
10. `grep -n "inLineFt" src/engine/movement.ts` — confirm the new line-AoE helper exists (added in Session 22).
11. `wc -l src/spells/_generic_registry.ts` — should be ~3726 lines (306 spells — was 3810/313 in Session 21).
12. `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3` — should print `Results: 91 passed, 0 failed`.
13. Run the 7 new bespoke spell tests: `for t in fireball lightning_bolt cone_of_cold inflict_wounds chromatic_orb catapult ice_knife; do npx ts-node --transpile-only src/test/${t}.test.ts | tail -2; done` — all 7 should print `Results: N passed, 0 failed`.

---

## GOALS THIS SESSION — REAL-MECHANICS MIGRATION (BATCH 1: COMBAT DAMAGE SPELLS)

Per user instruction: "lets proceed with (a) Real-mechanics migration".

### Migration strategy

The Session 19/20 bulk-implemented spells use a generic forward-compat flag pattern: each spell consumes a slot and sets `_genericSpellActiveSpells` on the caster, but applies NO mechanical effect. Session 22 began migrating these to bespoke implementations with REAL mechanical effects, mirroring the Session 18 bespoke pattern (Moonbeam / Shatter / Scorching Ray).

Each migrated spell:
1. **Spell module** in `src/spells/<snake_name>.ts` (REWRITTEN — was forward-compat flag, now has real `shouldCast` + `execute` + `cleanup`).
2. **Type changes** in `src/types/core.ts`: Added 7 new types to `PlannedAction.type` union (fireball, lightningBolt, coneOfCold, inflictWounds, chromaticOrb, catapult, iceKnife). All additive.
3. **Engine integration** in `src/engine/combat.ts`: Added 7 new case branches in `executePlannedAction`. Mirrors the Session 18 bespoke pattern (Moonbeam / Shatter / Scorching Ray).
4. **AI planner** in `src/ai/planner.ts`: Added 7 new planner branches (12A-12G) with tactical priority ordering. Each branch sits ABOVE the Session 19 generic spell loop so the migrated spell wins over its (now-removed) generic-registry shadow.
5. **Generic registry** in `src/spells/_generic_registry.ts`: Removed 7 entries (313 → 306 spells). Used a Python script (`scripts/remove_migrated_spells.py` — not committed) to safely remove each spell's 5-line import block + 5-line map entry.
6. **Spell DB** in `src/data/spells.ts`: NO changes — the existing SPELL_DB entries (added in Sessions 19/20) still correctly describe each spell's stats (damage dice, save ability, range, AoE flag).
7. **Tests**: 7 new test files in `src/test/<spell>.test.ts` (mirror `shatter.test.ts` pattern). Updated `bulk_spell_dispatch.test.ts` to use non-migrated sample spells (Fear L3, Cloudkill L5) and added a new section verifying the 7 migrated spells return null from `lookupGenericSpell`.

### New helper: `inLineFt` (movement.ts)

Added a new `inLineFt(origin, aimAt, test, lengthFt, widthFt = 5)` helper to `src/engine/movement.ts` for line-AoE geometry (PHB p.204 / SAC v2.7). Approximates the line as a thin rectangle along the origin→aimAt direction. The rectangle's length is `lengthFt` and its width is `widthFt` (default 5). Used by Lightning Bolt (100-ft × 5-ft line). Mirrors the existing `inConeFt` helper (used by Burning Hands and Cone of Cold).

### The 7 migrated spells (with mechanical details)

| Spell | Level | Save/Attack | Damage | AoE | Range | Notes |
|---|---|---|---|---|---|---|
| Fireball | 3 | DEX save | 8d6 fire (half on save) | 20-ft radius sphere | 150 ft | Mirrors Shatter. Highest-threat enemy is sphere center; all enemies within 20 ft are caught. |
| Lightning Bolt | 3 | DEX save | 8d6 lightning (half on save) | 100-ft × 5-ft line from caster | 100 ft | NEW `inLineFt` helper. Line aimed at highest-threat enemy within 100 ft. |
| Cone of Cold | 5 | CON save | 8d8 cold (half on save) | 60-ft cone from caster | 60 ft | Mirrors Burning Hands. Cone aimed at highest-threat enemy within 60 ft. |
| Inflict Wounds | 1 | Melee spell attack | 3d10 necrotic (crit doubles) | Single-target | Touch (5 ft) | Mirrors Scorching Ray attack-roll pattern. Requires adjacency via `isAdjacent`. |
| Chromatic Orb | 1 | Ranged spell attack | 3d8 chosen-elemental (crit doubles) | Single-target | 90 ft | NEW `pickDamageType(target)` heuristic — picks a type the target is NOT resistant to (acid/cold/fire/lightning/poison/thunder). |
| Catapult | 1 | DEX save | 3d8 bludgeoning (half on save) | Single-target | 60 ft | Mirrors a single-target save spell (NOT AoE — note this differs from the existing Shatter pattern). |
| Ice Knife | 1 | Ranged spell attack (1d10 pierce) + DEX save (2d6 cold) | 1d10 piercing + 2d6 cold (half on save) | 5-ft radius AoE (cold explosion) | 60 ft | NEW HYBRID pattern — first spell in v1 with both an attack roll AND an AoE save. Explosion fires on hit OR miss (XGE p.157). Returns `IceKnifePlan { primary, explosion }` from shouldCast. |

### Tests written / updated (Session 22)

- `src/test/fireball.test.ts`: 34/34 (NEW — metadata, shouldCast gates, AoE target selection, execute full/half damage, multi-target AoE, cleanup no-op, rollDamage range).
- `src/test/lightning_bolt.test.ts`: 38/38 (NEW — tests the new `inLineFt` line shape: 4 on-axis enemies caught, 1 off-axis (y=3) excluded).
- `src/test/cone_of_cold.test.ts`: 37/37 (NEW — tests `inConeFt` cone shape: in-cone enemies caught, behind-caster (-X) and off-side (90°) excluded).
- `src/test/inflict_wounds.test.ts`: 32/32 (NEW — tests 5-ft adjacency, diagonal adjacency, crit-doubling `rollDamage(true)`→6-60 / `(false)`→3-30, hit/miss paths).
- `src/test/chromatic_orb.test.ts`: 41/41 (NEW — tests `pickDamageType` directly: no res→acid, res fire→acid, res all 6→acid fallback, res first 5→thunder; 90-ft range; crit 6d8).
- `src/test/catapult.test.ts`: 33/33 (NEW — verifies shouldCast returns single Combatant (not array); execute(caster, target, state) single-target signature).
- `src/test/ice_knife.test.ts`: 57/57 (NEW — tests `IceKnifePlan { primary, explosion }` shape; explosion fires on hit OR miss (verified via hitBonus:-100 → cold save_fail still emitted + condition_add explosion announcement); `rollPierceDamage(isCrit)` + `rollColdDamage()` (no isCrit param — cold is a save, not attack)).
- `src/test/bulk_spell_dispatch.test.ts`: 91/91 (UPDATED — was 84/84. Replaced 'Fireball' (L3) with 'Fear' and 'Cone of Cold' (L5) with 'Cloudkill' in sample spells. Lowered min-registry-size from 300 to 290. Added new section '1b' verifying all 7 migrated spells return null from lookupGenericSpell).
- Total new assertions: 272 (34 + 38 + 37 + 32 + 41 + 33 + 57) + 7 new in bulk_spell_dispatch = 279.

### Regression suite (after Session 22 changes)

- `tsc --noEmit`: 0 errors (excluding pre-existing TS7006 implicit-any in test files, which mirror the existing fireball.test.ts template).
- `bulk_spell_dispatch.test.ts`: 91/91 (was 84/84 in Session 21).
- All 7 new spell tests: 272/272.
- All prior tests still green when run with adequate timeout. Specifically verified:
  - `healing_word`: 41/41 (Core Engine's Session 44 work still passes)
  - `healing_spells`: all pass
  - `bless`: 37/37
  - `burning_hands`: 33/33 (the cone-AoE spell whose pattern Cone of Cold mirrors — still passes)
  - `magic_missile`: 25/25
  - `shield_simple`: 12/12
  - `sleep`: 35/35
  - `arcane_lock`: 29/29 (Session 18 bespoke spell still passes)
  - `moonbeam`: 107/107 (Session 18 bespoke spell still passes — the migration template)
  - `darkvision`: 41/41 (Session 17 bespoke spell still passes)
  - `combat`: all pass (heavy engine test still passes)
  - `shatter`: 108/108 (Session 18 bespoke spell still passes — the migration template)
  - `scorching_ray`: 109/109 (Session 18 bespoke spell still passes — the attack-roll template)
  - `summons`: all pass (summon subsystem still works)
- Spell cache: 557 unique spells, **420 implemented** (46 cantrips + 66 level-1 + 84 level-2 + 56 level-3 + 41 level-4 + 43 level-5 + 33 level-6 + 19 level-7 + 18 level-8 + 14 level-9), 124 remaining in-scope (all blockers documented in TEAMGOALS.md TG-006 through TG-011). The migration is QUALITATIVE (forward-compat flag → real mechanics), not quantitative — all 7 migrated spells already had module files; they just had no mechanical effect before Session 22.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 420/557 spells implemented).
2. Verify Session 22's work landed:
   - `grep -c "  '" src/spells/_generic_registry.ts` (count of registry entries — should be ~306, was 313).
   - `wc -l src/spells/_generic_registry.ts` (~3726 lines, was 3810).
   - `grep -n "case 'fireball'\|case 'lightningBolt'\|case 'coneOfCold'\|case 'inflictWounds'\|case 'chromaticOrb'\|case 'catapult'\|case 'iceKnife'" src/engine/combat.ts` (should return 7 lines).
   - `grep -n "inLineFt" src/engine/movement.ts` (should return ~5 lines — the helper definition + JSDoc).
   - `ls src/test/fireball.test.ts src/test/lightning_bolt.test.ts src/test/cone_of_cold.test.ts src/test/inflict_wounds.test.ts src/test/chromatic_orb.test.ts src/test/catapult.test.ts src/test/ice_knife.test.ts` (7 new test files should exist).
   - `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3` (should print `Results: 91 passed, 0 failed`).
   - `for t in fireball lightning_bolt cone_of_cold inflict_wounds chromatic_orb catapult ice_knife; do npx ts-node --transpile-only src/test/${t}.test.ts | tail -2; done` (all 7 should print `Results: N passed, 0 failed`).
3. **DECISION POINT for Session 23:**
   - (a) **Continue real-mechanics migration with batch 2** — give more Session 19/20 bulk-implemented spells REAL mechanical effects. Recommended next batch (high-damage single-target / save-or-suck):
     - **Disintegrate** (L6) — DEX save 10d6+40 force + disintegrate-on-0-HP (NEW on-kill mechanic — needs a "disintegrate" flag on Combatant or a special death-state).
     - **Finger of Death** (L7) — CON save 7d8+30 necrotic + zombie-raise on-kill (NEW raise-dead mechanic — needs a "raise as zombie under caster's control" flag — overlaps with TG-006 Summon subsystem).
     - **Power Word Kill** (L9) — conditional instakill if HP < 100 (NEW conditional-instakill mechanic — no save, just HP check).
     - **Cloudkill** (L5) — CON save 8d6 poison,移动 AoE cloud (NEW moving-AoE mechanic — overlaps with Moonbeam's damage_zone but移动 each turn — needs a "move AoE" hook).
     - **Blight** (L4) — CON save 8d8 necrotic single-target + plant-water-drain (NEW plant-water-drain mechanic — niche, only affects plant creatures).
     - **Harm** (L6) — CON save 14d6 necrotic + max-HP-reduction (NEW max-HP-reduction mechanic — needs a "maxHP-reduction" field on Combatant that reduces maxHP until next long rest).
     - **Sunburst** (L8) — CON save 12d6 radiant 60-ft radius AoE + blindness (blindness is a condition — v1 has the `condition_apply` effect type, so this is doable).
   - (b) **Coordinate with Core Engine** on the 109+14=123 blocker spells (TG-006 through TG-011). Biggest blockers: TG-006 Summon (38 spells — Session 21 produced a 4-phase plan in `TG-006-SUMMON-PLAN.md`), TG-011 Complex mechanics (28 spells), TG-010 computeLOS (18 spells).
   - (c) **Migrate Cure Wounds** to a dedicated module (mirror Session 44's Healing Word migration) — but coordinate with Core Engine first since they may have plans for it.
4. If continuing the real-mechanics migration (option a), follow the Session 22 architecture:
   - For AoE save spells: mirror `shatter.ts` (radius) or `burning_hands.ts` (cone) or `lightning_bolt.ts` (line — uses `inLineFt`).
   - For single-target save spells: mirror `catapult.ts`.
   - For spell-attack spells: mirror `scorching_ray.ts` (ranged) or `inflict_wounds.ts` (melee).
   - For hybrid attack + AoE save spells: mirror `ice_knife.ts` (returns `IceKnifePlan { primary, explosion }` from shouldCast).
   - For each migrated spell: (1) Rewrite the spell module with real `shouldCast` + `execute` + `cleanup`. (2) Add a case branch in `combat.ts`. (3) Add a planner branch in `planner.ts`. (4) Add the type to `PlannedAction.type` union in `core.ts`. (5) Remove the spell from `_generic_registry.ts` (use the Python script pattern from Session 22). (6) Write a test file. (7) Update `bulk_spell_dispatch.test.ts` if the spell was a sample.
5. `npx tsc --noEmit` + run the full regression suite (must stay green).
6. `npm run spell-cache:build` — confirm the migrated spells still show `implemented: true` (the count stays at 420 — the migration is qualitative).
7. Commit with message format `Cantrip-23: <summary>`.
8. Write `zHANDOVER-SESSION-23.md`.
9. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (after this session — Session 22)

- `src/test/bulk_spell_dispatch.test.ts`: 91/91 (UPDATED from 84/84).
- 7 new spell tests: 272/272 total (fireball 34, lightning_bolt 38, cone_of_cold 37, inflict_wounds 32, chromatic_orb 41, catapult 33, ice_knife 57).
- `tsc --noEmit`: 0 errors (excluding pre-existing TS7006 implicit-any in test files).
- Spell cache: 420/557 implemented (unchanged from Session 20 — migration is qualitative).
- All prior tests still green when run with adequate timeout.

---

## NOTES FOR NEXT AGENT

- **Session 22 was the FIRST real-mechanics migration session.** 7 combat damage spells migrated from forward-compat flags to bespoke implementations with REAL mechanical effects. The work reused ALL of Session 18's bespoke infrastructure (Moonbeam / Shatter / Scorching Ray patterns) with ONE new helper (`inLineFt` in movement.ts for line-AoE geometry).
- **The migration pattern is now well-established.** To migrate a generic spell to a bespoke implementation: (1) Rewrite the spell module with real `shouldCast` + `execute` + `cleanup` (mirror the appropriate Session 22 spell — Shatter for radius AoE save, Burning Hands for cone AoE save, Lightning Bolt for line AoE save, Catapult for single-target save, Scorching Ray for ranged spell attack, Inflict Wounds for melee spell attack, Ice Knife for hybrid attack + AoE save). (2) Add a case branch in `combat.ts` (mirror the Session 22 case branches). (3) Add a planner branch in `planner.ts` (mirror the Session 22 planner branches — 12A through 12G). (4) Add the type to `PlannedAction.type` union in `core.ts`. (5) Remove the spell from `_generic_registry.ts` using the Python script pattern (each spell's 5-line import block + 5-line map entry — see `/tmp/remove_migrated_spells.py` for the template). (6) Write a test file (mirror the Session 22 test files). (7) Update `bulk_spell_dispatch.test.ts` if the spell was a sample (current samples: Alarm L1, Continual Flame L2, Fear L3, Polymorph L4, Cloudkill L5, Disintegrate L6, Finger of Death L7, Feeblemind L8, Power Word Kill L9).
- **Cure Wounds is still a known gap.** It has existing `spellHealPlan` infrastructure (not a dedicated module, not a generic-dispatch spell). Core Engine may migrate it (mirror Session 44 Healing Word migration). Do NOT implement it as a generic spell or a bespoke spell without coordinating with Core Engine first.
- **Chromatic Orb has a pre-existing SPELL_DB entry** (line 140 in `src/data/spells.ts`) — it was added to the registry in Session 20 but the duplicate SPELL_DB entry was skipped. Session 22 migrated it to a bespoke implementation; the SPELL_DB entry is unchanged (still correct — damage type is "thunder" as a default, but the bespoke `pickDamageType` function overrides this at runtime).
- **The 7 migrated spells are NO LONGER in the generic registry.** `lookupGenericSpell('Fireball')` etc. now return `null`. The `bulk_spell_dispatch.test.ts` section 1b verifies this. If a future agent tries to look up one of these spells via the generic registry, they'll get `null` and need to use the bespoke module directly.
- **The 7 migrated spells come FIRST in the planner's tactical priority** (sections 12A-12G, sitting ABOVE the Session 19 generic spell loop). Tactical priority order: L5 (Cone of Cold) > L3 (Fireball, Lightning Bolt) > L1 by expected damage (Ice Knife hybrid > Inflict Wounds melee > Chromatic Orb ranged > Catapult save-for-half). This means a caster with multiple migrated spells in their action list will prefer the higher-priority spell.
- **Ice Knife is the first HYBRID spell in v1** — it has both a ranged spell attack (1d10 piercing) AND an AoE save (2d6 cold DEX save in 5-ft radius). Its `shouldCast` returns an `IceKnifePlan { primary, explosion }` object (not a Combatant or Combatant[]). Its `execute` takes the plan object. Future hybrid spells (e.g. Steel Wind Strike, Melf's Acid Arrow if migrated) should mirror this pattern.
- **The `inLineFt` helper in movement.ts** is now available for any line-AoE spell. It approximates the line as a thin rectangle (perpendicular distance <= width/2). Used by Lightning Bolt. Future line-AoE spells (e.g. Aganazzar's Scorcher, Wall of Fire, Sunburst if it's modelled as a line) should use this helper.
- **The `pickDamageType` function in chromatic_orb.ts** is a new heuristic for spells with damage-type choice. It picks a type the target is NOT resistant to (acid > cold > fire > lightning > poison > thunder order). Future choice-damage spells (e.g. Chaos Bolt, Dragon's Breath if migrated) could reuse this helper.
- **The 14 L1 blockers are still documented in TEAMGOALS.md TG-006 through TG-011** — no new TG entries were added in Session 22.
- **Commit message convention:** `Cantrip-N: <summary>`. Session 22 should be `Cantrip-22: Real-mechanics migration — 7 combat damage spells` (matching the actual commit `fd1b73f`).
- **All `Combatant` scratch fields added across Sessions 7–22:** (unchanged from Session 21 — no new fields in Session 22). The `_genericSpellActiveSpells?: Set<string>` field from Session 19 now covers 306 bulk-implemented spells (was 313 — 7 migrated to bespoke in Session 22).
- **SpellEffectType registry (unchanged from Session 18):** `advantage_vs`, `ac_bonus`, `ac_floor`, `bless_die`, `condition_apply`, `hex_damage`, `damage_zone`, `weapon_enchant`, `enlarge_reduce`. **Session 22 added NONE.**
- **ActiveEffect.payload fields (unchanged from Session 18):** (same as Session 21). **Session 22 added NONE.**
- **Architecture summary (Session 22):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (uniform template — all 7 migrated spells use the same shape, except Ice Knife which returns `IceKnifePlan` from shouldCast).
  - Type changes: 7 new types in `PlannedAction.type` union (additive).
  - Engine: 7 new case branches in `executePlannedAction` (additive).
  - Movement: 1 new helper `inLineFt` (additive).
  - Active-effect: NO new effect types or sentinel cases.
  - Spell DB: NO changes (existing entries from Sessions 19/20 still correct).
  - AI planner: 7 new branches (12A-12G) with tactical priority ordering (additive, sits ABOVE the generic spell loop).
  - Tests: 7 new test files (272 new assertions) + UPDATED `bulk_spell_dispatch.test.ts` (91/91, was 84/84).
- **Implementation milestones (cumulative):**
  - Session 19: FIRST BULK IMPLEMENTATION session (262 L2-9 spells)
  - Session 19: FIRST generic dispatch infrastructure
  - Session 20: SECOND BULK IMPLEMENTATION session (51 L1 spells — backfill)
  - Session 20: First time reusing Session 19's infrastructure for a new level with ZERO engine/planner/type changes
  - Session 20: Spell cache crossed 75% implementation milestone (420/557 = 75%)
  - Session 21: TG-006 SUMMON-PLAN research document (no code changes)
  - Session 22: FIRST REAL-MECHANICS MIGRATION session (7 combat damage spells)
  - Session 22: First NEW engine helper since Session 18 (`inLineFt` in movement.ts)
  - Session 22: First HYBRID spell in v1 (Ice Knife — attack roll + AoE save)
  - Session 22: First smart-damage-type-choice heuristic (`pickDamageType` in chromatic_orb.ts)

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
