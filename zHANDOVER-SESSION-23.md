# zHANDOVER-SESSION-23

## REPOSITORY

- Branch: main
- Prior commits (cantrip-z workstream — real-mechanics migration):
  - `<new>` — Cantrip-23: Real-mechanics migration batch 2 — 7 high-damage spells L4-9 (Blight, Cloudkill, Disintegrate, Harm, Finger of Death, Sunburst, Power Word Kill). Migrated from the Session 19 generic-dispatch forward-compat flags to bespoke implementations with REAL mechanical effects (CON/DEX saves, HP-check instakill, AoE damage + blindness). Mirrors the Session 22 bespoke patterns (Catapult for single-target saves, Shatter/Fireball for AoE saves, Blindness/Deafness for condition_apply) PLUS one NEW pattern: Power Word Kill's HP-check instakill (no save, no attack — first spell in v1 with neither). Added 7 new case branches in combat.ts + 7 new planner branches in planner.ts (12H-12N, tactical priority: L9 instakill > L8 AoE > L7 > L6 kill-shot > L6 > L5 AoE > L4). Added 7 new types to PlannedAction.type union in core.ts. Removed 7 entries from _generic_registry.ts (306 → 299 spells). Wrote 7 new test files (256 new assertions, all passing). Updated bulk_spell_dispatch.test.ts (98/98, was 91/91 — added section 1c verifying migrated spells are no longer in the registry; replaced 4 migrated sample spells with non-migrated alternatives: Cloudkill→Hold Monster, Disintegrate→Globe of Invulnerability, Finger of Death→Forcecage, Power Word Kill→Time Stop). All prior tests still green (healing_word, healing_spells, bless, burning_hands, magic_missile, shield_simple, sleep, arcane_lock, moonbeam, darkvision, combat, shatter, scorching_ray, summons, + all 7 Session 22 spell tests). tsc --noEmit: 0 errors (excluding pre-existing TS7006 implicit-any in test files). Spell cache: 420/557 (unchanged — migration is qualitative, not quantitative).
  - `fd1b73f` — Cantrip-22: Real-mechanics migration — 7 combat damage spells (Fireball, Lightning Bolt, Cone of Cold, Inflict Wounds, Chromatic Orb, Catapult, Ice Knife).
  - `b53b622` — Cantrip-21: TG-006 summon subsystem research + 4-phase plan (no code changes).
  - `98f5b00` — Cantrip-20: BULK-IMPLEMENT 51 non-blocker in-scope L1 spells (generic dispatch pattern).
  - `c0aebb4` — Cantrip-19: BULK-IMPLEMENT 262 non-blocker in-scope spells from levels 2-9 (generic dispatch pattern).
  - `aa6c65a` — Cantrip-18: Implement 20 PHB level-2 spells (batch 4 — double-sized per user instruction '15 more than requested').
  - (see `zHandoversOld/` for Cantrip-1 through Cantrip-17, and `zHANDOVER-SESSION-22.md` for Session 22)
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
- **Session 21 produced a TG-006 SUMMON-PLAN research document** (no code changes) — 4-phase plan for taking over the Summon subsystem.
- **Session 22 began the REAL-MECHANICS MIGRATION** — migrated 7 combat damage spells (Fireball, Lightning Bolt, Cone of Cold, Inflict Wounds, Chromatic Orb, Catapult, Ice Knife) from generic-dispatch forward-compat flags to bespoke implementations with REAL mechanical effects.
- **Session 23 (THIS SESSION) continued the real-mechanics migration with BATCH 2** — migrated 7 high-damage spells from levels 4-9:
  - **Blight** (PHB L4) — CON save + 8d8 necrotic single-target. Mirrors Catapult (single-target save). Plant-water-drain + undead/construct immunity simplified away (no creature-type tag).
  - **Cloudkill** (PHB L5) — CON save + 5d8 poison in 20-ft radius AoE (one-shot). Mirrors Shatter (radius AoE save). Moving-AoE + concentration rider simplified away (no "move AoE" hook in v1). NOTE: PHB p.222 says 5d8 (the Session 22 handover's "8d8" recommendation was a typo — v1 uses the canon 5d8, matching the SPELL_DB entry).
  - **Disintegrate** (PHB L6) — DEX save + 10d6+40 force single-target. Mirrors Catapult (single-target save) with a NEW flat-damage-bonus field (`flatDamageBonus: 40`). Disintegrate-on-0-HP simplified away (no "disintegrated" death-state). FIRST spell in v1 with a flat damage bonus on a save spell.
  - **Harm** (PHB L6) — CON save + 14d6 necrotic single-target. Mirrors Catapult (single-target save). Max-HP-reduction rider simplified away (no maxHP-reduction field on Combatant).
  - **Finger of Death** (PHB L7) — CON save + 7d8+30 necrotic single-target. Mirrors Disintegrate (single-target save with flat bonus). Zombie-raise-on-kill simplified away (TG-006 summon subsystem pending).
  - **Sunburst** (PHB L8) — CON save + 12d6 radiant in 60-ft radius AoE + blinded on failed save. Mirrors Fireball (radius AoE save) + Blindness/Deafness (condition_apply for blinded). End-of-turn save to end blindness NOT modelled (same gap as Blindness/Deafness).
  - **Power Word Kill** (PHB L9) — NO save, NO attack — instakill if target's currentHP ≤ 100. NEW PATTERN (first spell in v1 with no save AND no attack roll — purely an HP check). shouldCast gates on the target's currentHP (first spell in v1 to do so). PC instant-death simplified to unconscious+death-saves (conservative reading — canon says "dies" = instant death for PCs).
- **Total implemented: 420/557 (unchanged from Session 20)** — the migration is QUALITATIVE (forward-compat flag → real mechanics), not quantitative. 124 in-scope spells remain — all are blockers documented in TEAMGOALS.md (109 from Session 19 + 14 from Session 20 + Cure Wounds).
- **Session 24+ should continue the real-mechanics migration** with the next batch. Recommended next batch (control/save-or-suck + utility): Chain Lightning (L6 — DEX save 10d8 lightning, multi-target — NEW multi-target single-save pattern), Otiluke's Freezing Sphere (L6 — DEX save 10d6 cold 60-ft radius AoE), Delayed Blast Fireball (L7 — DEX save 12d6 fire 20-ft radius AoE + delayed-detonation mechanic), Prismatic Spray (L8 — 8-ray random-effect table), Earthquake (L8 — multi-effect terrain), Meteor Swarm (L9 — DEX save 20d6 fire + 20d6 bludgeoning in 40-ft radius AoE, 4 impact points), Wish (L9 — universal — likely a blocker).
- **Forward-compat subsystems (Session 14 pivot direction) tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem — still OPEN.
  - TG-002: Concentration subsystem — still OPEN; partial implementation exists.
  - TG-003: AI planner cantrip selection — still OPEN.
  - TG-004: Parser tech debt — still OPEN.
  - TG-005: Illusion-disbelief Investigation check — still OPEN.
  - TG-006: Summon/Conjure subsystem — OPEN, 38 spells blocked. Session 21 produced a 4-phase plan.
  - TG-007: Wall subsystem — OPEN, 12 spells blocked.
  - TG-008: Reaction spell subsystem — OPEN, 5 spells blocked.
  - TG-009: Antimagic/Dispel subsystem — OPEN, 3 spells blocked.
  - TG-010: computeLOS/vision-blocking — OPEN, 18 spells blocked.
  - TG-011: Complex mechanics — OPEN, 28 spells blocked.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- Do NOT touch another workstream's handover files.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-22.md`** (the prior session — first real-mechanics migration batch).
3. Read **`TEAMGOALS.md`** — cross-workstream coordination.
4. Read **`SPELL-CACHE.md`** — the cache + picker workflow.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 23 end: 420/557 spells implemented. 124 in-scope blockers remain.
7. `grep -n "case 'blight'\|case 'cloudkill'\|case 'disintegrate'\|case 'harm'\|case 'fingerOfDeath'\|case 'sunburst'\|case 'powerWordKill'" src/engine/combat.ts` — confirm the 7 Session 23 bespoke case branches exist.
8. `wc -l src/spells/_generic_registry.ts` — should be ~3642 lines (299 spells — was 3726/306 in Session 22).
9. `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3` — should print `Results: 98 passed, 0 failed`.
10. Run the 7 new bespoke spell tests: `for t in blight cloudkill disintegrate harm finger_of_death sunburst power_word_kill; do npx ts-node --transpile-only src/test/${t}.test.ts | tail -2; done` — all 7 should print `Results: N passed, 0 failed`.

---

## GOALS THIS SESSION — REAL-MECHANICS MIGRATION (BATCH 2: HIGH-DAMAGE SPELLS L4-9)

Per user instruction: "Resume the workstream... do the real implementation to as many spells as possible". Session 22's handover recommended continuing the real-mechanics migration with batch 2 (high-damage single-target / save-or-suck spells).

### Migration strategy

The Session 19/20 bulk-implemented spells use a generic forward-compat flag pattern. Sessions 22 and 23 migrate these to bespoke implementations with REAL mechanical effects, mirroring the Session 18 bespoke pattern (Moonbeam / Shatter / Scorching Ray).

Each migrated spell:
1. **Spell module** in `src/spells/<snake_name>.ts` (REWRITTEN — was forward-compat flag, now has real `shouldCast` + `execute` + `cleanup`).
2. **Type changes** in `src/types/core.ts`: Added 7 new types to `PlannedAction.type` union (blight, cloudkill, disintegrate, harm, fingerOfDeath, sunburst, powerWordKill). All additive.
3. **Engine integration** in `src/engine/combat.ts`: Added 7 new case branches in `executePlannedAction`. Mirrors the Session 22 bespoke pattern.
4. **AI planner** in `src/ai/planner.ts`: Added 7 new planner branches (12H-12N) with tactical priority ordering. Each branch sits ABOVE the Session 19 generic spell loop so the migrated spell wins over its (now-removed) generic-registry shadow.
5. **Generic registry** in `src/spells/_generic_registry.ts`: Removed 7 entries (306 → 299 spells). Used a Python script (`scripts/remove_migrated_spells_s23.py`) to safely remove each spell's 5-line import block + 6-line map entry.
6. **Spell DB** in `src/data/spells.ts`: NO changes — the existing SPELL_DB entries (added in Session 19) still correctly describe each spell's stats. NOTE: 3 SPELL_DB entries have known discrepancies (Blight isAoE:true should be false per PHB; Harm isAoE:true should be false per PHB; Disintegrate damage:null should be 10d6+40; Finger of Death damage:null should be 7d8+30) — these are documented in each spell module's forward-compat flags and do NOT affect the bespoke implementation (which has its own correct metadata).
7. **Tests**: 7 new test files in `src/test/<spell>.test.ts` (mirror `catapult.test.ts` / `fireball.test.ts` / `disintegrate.test.ts` patterns). Updated `bulk_spell_dispatch.test.ts` to replace 4 migrated sample spells with non-migrated alternatives + added section 1c verifying the 7 Session 23 migrated spells return null from `lookupGenericSpell`.

### The 7 migrated spells (with mechanical details)

| Spell | Level | Save/Attack | Damage | AoE | Range | Notes |
|---|---|---|---|---|---|---|
| Blight | 4 | CON save | 8d8 necrotic (half on save) | Single-target | 30 ft | Mirrors Catapult. Plant-creature disadv + undead/construct immunity simplified (no creature-type tag). |
| Cloudkill | 5 | CON save | 5d8 poison (half on save) | 20-ft radius sphere | 120 ft | Mirrors Shatter. Moving-AoE + concentration rider simplified (one-shot in v1). PHB damage is 5d8 (not 8d8 — handover typo). |
| Disintegrate | 6 | DEX save | 10d6+40 force (half on save, total halved) | Single-target | 60 ft | Mirrors Catapult + NEW `flatDamageBonus: 40` field. FIRST save spell with flat bonus. Disintegrate-on-0-HP simplified (no ash-pile death-state). shouldCast has kill-shot bias (lowest current HP first). |
| Harm | 6 | CON save | 14d6 necrotic (half on save) | Single-target | 60 ft | Mirrors Catapult. Max-HP-reduction rider simplified (no maxHP-reduction field on Combatant). |
| Finger of Death | 7 | CON save | 7d8+30 necrotic (half on save, total halved) | Single-target | 60 ft | Mirrors Disintegrate (flat bonus). Zombie-raise-on-kill simplified (TG-006 summon subsystem pending). |
| Sunburst | 8 | CON save | 12d6 radiant (half on save) + blinded on fail | 60-ft radius sphere | 150 ft | Mirrors Fireball (AoE save) + Blindness/Deafness (condition_apply for blinded). End-of-turn save to end blindness NOT modelled. Skip-if-already-blinded guard prevents double-apply. |
| Power Word Kill | 9 | NONE (no save, no attack) | Instakill if currentHP ≤ 100 | Single-target | 60 ft | NEW PATTERN — first spell in v1 with no save AND no attack. shouldCast gates on target's currentHP (first spell to do so). PC instant-death simplified to unconscious+death-saves. Slot consumed unconditionally (PHB p.266). HP re-check inside execute() (target may be healed between plan + execute). |

### New mechanics introduced in Session 23

1. **Flat damage bonus on save spells** (`metadata.flatDamageBonus`): Disintegrate (+40) and Finger of Death (+30) are the first save spells in v1 with a flat damage bonus added on top of the dice. The bonus IS halved on a successful save (conservative reading — v1 halves the total dice+bonus, matching the Shatter/Catapult half-on-save pattern). The `rollDamage(includeFlat = true)` helper supports inspecting the dice-only total for tests.

2. **HP-check instakill pattern** (Power Word Kill): The first spell in v1 with NO save AND NO attack roll. The effect is purely an HP check — if the target's currentHP ≤ 100, it dies instantly. shouldCast gates on `e.currentHP ≤ metadata.hpThreshold` (first spell to read currentHP in shouldCast). execute() sets currentHP=0, isDead=true (monsters) or isUnconscious=true (PCs — conservative simplification; canon says PCs "die" = instant death, but v1 uses the death-save subsystem for consistency). The slot is consumed UNCONDITIONALLY (PHB p.266: "You utter a word of power" — spent whether or not the target dies). execute() re-checks the HP gate (target may be healed above 100 between planTurn and executePlannedAction).

3. **condition_apply for blinded on failed save** (Sunburst): Mirrors Blindness/Deafness's pattern — `applySpellEffect(target, { effectType: 'condition_apply', payload: { condition: 'blinded' }, sourceIsConcentration: false })`. The blindness persists for the entire v1 combat (1-min duration not tracked — same gap as Blindness/Deafness). A skip-if-already-blinded guard prevents double-applying the condition (and avoids a misleading "BLINDED" log when the target was already blinded).

### Tests written / updated (Session 23)

- `src/test/blight.test.ts`: 33/33 (NEW — metadata, shouldCast gates, single-target selection, range gating, execute full/half damage, single-target no-spillover, rollDamage 8d8 range, cleanup no-op).
- `src/test/cloudkill.test.ts`: 33/33 (NEW — AoE target selection, 20-ft radius sphere, multi-target AoE, execute full/half damage, rollDamage 5d8 range, cleanup no-op).
- `src/test/disintegrate.test.ts`: 36/36 (NEW — metadata incl. flatDamageBonus:40, kill-shot-bias target selection, execute full/half damage (total halved), death + disintegrate flavour log, rollDamage with/without flat bonus, cleanup no-op).
- `src/test/harm.test.ts`: 28/28 (NEW — metadata, highest-threat-bias target selection, execute full/half damage 14d6, single-target no-spillover, rollDamage 14d6 range, cleanup no-op).
- `src/test/finger_of_death.test.ts`: 32/32 (NEW — metadata incl. flatDamageBonus:30, highest-threat-bias, execute full/half damage 7d8+30, death + zombie-raise flavour log, rollDamage with/without flat bonus, cleanup no-op).
- `src/test/sunburst.test.ts`: 46/46 (NEW — metadata, 60-ft radius AoE target selection, execute full damage + blinded on fail, half damage + NO blindness on save, multi-target AoE + multi-blindness, already-blinded no-double-apply, rollDamage 12d6 range, cleanup no-op).
- `src/test/power_word_kill.test.ts`: 48/48 (NEW — metadata incl. hpThreshold:100 + no-save-no-attack flags, shouldCast HP-gate boundary tests (100 inclusive, 101 exclusive), highest-current-HP-≤-100 bias target selection, execute instakill (monster), no-effect-when-HP>100 (slot still consumed), boundary HP=100 dies, already-dead no-op, cleanup no-op).
- `src/test/bulk_spell_dispatch.test.ts`: 98/98 (UPDATED — was 91/91. Added section 1c verifying all 7 Session 23 migrated spells return null from lookupGenericSpell. Replaced 4 migrated sample spells: Cloudkill L5 → Hold Monster, Disintegrate L6 → Globe of Invulnerability, Finger of Death L7 → Forcecage, Power Word Kill L9 → Time Stop. Lowered min-registry-size from 290 to 280. Updated comments to reflect Session 22 + 23 migrations).
- Total new assertions: 256 (33 + 33 + 36 + 28 + 32 + 46 + 48) + 7 new in bulk_spell_dispatch = 263.

### Regression suite (after Session 23 changes)

- `tsc --noEmit`: 0 errors (excluding pre-existing TS7006 implicit-any in test files, which mirror the existing fireball.test.ts template).
- `bulk_spell_dispatch.test.ts`: 98/98 (was 91/91 in Session 22).
- All 7 new Session 23 spell tests: 256/256.
- All 7 Session 22 spell tests still green: 272/272 (fireball 34, lightning_bolt 38, cone_of_cold 37, inflict_wounds 32, chromatic_orb 41, catapult 33, ice_knife 57).
- All prior tests still green. Specifically verified:
  - `healing_word`: 41/41
  - `healing_spells`: 36/36
  - `bless`: 37/37
  - `burning_hands`: 33/33
  - `magic_missile`: 25/25
  - `shield_simple`: 12/12
  - `sleep`: 35/35
  - `arcane_lock`: 29/29
  - `moonbeam`: 107/107
  - `darkvision`: 41/41
  - `combat`: 46/46
  - `shatter`: 108/108
  - `scorching_ray`: 109/109
  - `summons`: 51/51
- Spell cache: 557 unique spells, **420 implemented** (46 cantrips + 66 level-1 + 84 level-2 + 56 level-3 + 41 level-4 + 43 level-5 + 33 level-6 + 19 level-7 + 18 level-8 + 14 level-9), 124 remaining in-scope (all blockers documented in TEAMGOALS.md TG-006 through TG-011). The migration is QUALITATIVE (forward-compat flag → real mechanics), not quantitative — all 7 migrated spells already had module files; they just had no mechanical effect before Session 23.

---

## IMMEDIATE NEXT ACTION

> **🔴 MEGABATCH HANDOFF (Session 23 post-session work):** A comprehensive megabatch
> migration plan has been produced for the overnight long-running task feature. Two files
> were committed in Session 23's post-session work:
> - **`MEGABATCH-MIGRATION-PLAN.md`** — the full 4-batch spec (124 spells, ~31 hrs total)
> - **`MEGABATCH-ANALYSIS.json`** — the 255-spell feasibility analysis (124 migratable, 131 blocked)
>
> The megabatch migrates ALL 124 remaining migratable spells across 4 sequential overnight
> runs (Cantrip-24 through Cantrip-27):
> - **Batch 1 (Cantrip-24):** 44 combat damage spells (mirror Catapult/Shatter/Fireball/Sunburst/Scorching Ray/Power Word Kill)
> - **Batch 2 (Cantrip-25):** 35 save-or-condition spells (mirror Blindness/Deafness/Hold Person/Sunburst condition loop)
> - **Batch 3 (Cantrip-26):** 23 concentration buffs (mirror Hex/Bless/Magic Weapon/Faerie Fire)
> - **Batch 4 (Cantrip-27):** 22 persistent zones + healing + temp HP (mirror Moonbeam/Cloud of Daggers/Healing Word)
>
> After all 4 batches: spell cache 420 → 544/557 implemented (97.7%). The remaining 13
> are TG-006..011 blockers (summons, walls, reactions, antimagic, LOS, complex mechanics).
>
> **To run the megabatch:** Launch a long-running task agent with the prompt below. The
> prompt is also embedded in `MEGABATCH-MIGRATION-PLAN.md` §"AGENT LAUNCH PROMPT" — copy
> it from there for the exact wording. The key operational rules: **commit incrementally
> every 8-12 spells** (NOT once at the end — so progress survives a crash), **push after
> every commit**, and **keep going** until all 4 batches are done OR the time budget is hit.
>
> ```
> You are migrating D&D 5e spells in the dnd-combat-sim repo at
> /home/z/my-project/dnd-combat-sim.
>
> STEP 1: Read /home/z/my-project/dnd-combat-sim/MEGABATCH-MIGRATION-PLAN.md IN FULL
> before doing anything else. It is the complete spec — follow it exactly.
>
> STEP 2: `git pull origin main && npm install` to sync.
>
> STEP 3: Execute Batch 1 (44 combat damage spells), then Batch 2 (35 save-or-condition),
> then Batch 3 (23 buffs), then Batch 4 (22 zones/heals) — IN ORDER. Use the per-spell
> specs in the plan. Follow the 7-step migration recipe for each spell.
>
> CRITICAL OPERATIONAL RULES:
> - COMMIT INCREMENTALLY every 8-12 spells (NOT once at the end). Use commit messages
>   like "Cantrip-24 (spells 1-10 of 44): combat damage — chaos_bolt, earth_tremor, ...".
> - PUSH after every commit (`git push origin main`) so work is safely on GitHub.
> - KEEP GOING after each commit — a commit is a checkpoint, not a stopping point.
>   Continue until you finish all 4 batches OR you hit the time budget for this run.
> - If a spell is harder than expected, SKIP it (note in handover) and move to the next.
>   Do not block on one spell and lose the whole batch.
> - Run `npx tsc --noEmit` (excluding TS7006) + the new spell tests after each commit
>   to catch regressions early.
>
> STEP 4: When you finish all 4 batches OR hit the time budget, write
> zHANDOVER-SESSION-2N.md (N = 24 if you only did Batch 1, 25 if Batch 1+2, etc.)
> summarizing: what was migrated, what was skipped + why, test counts, and where the
> next run should pick up. Commit + push the handover.
>
> GOAL: migrate as many of the 124 spells as possible. 420/557 are implemented now;
> after all 4 batches it should be 544/557 (97.7%).
> ```

### Manual next-action (if NOT running the megabatch)

1. `git pull && npm install && npm run spell-cache:build` (confirm 420/557 spells implemented).
2. Verify Session 23's work landed:
   - `grep -c "  '" src/spells/_generic_registry.ts` (count of registry entries — should be ~299, was 306).
   - `wc -l src/spells/_generic_registry.ts` (~3642 lines, was 3726).
   - `grep -n "case 'blight'\|case 'cloudkill'\|case 'disintegrate'\|case 'harm'\|case 'fingerOfDeath'\|case 'sunburst'\|case 'powerWordKill'" src/engine/combat.ts` (should return 7 lines).
   - `ls src/test/blight.test.ts src/test/cloudkill.test.ts src/test/disintegrate.test.ts src/test/harm.test.ts src/test/finger_of_death.test.ts src/test/sunburst.test.ts src/test/power_word_kill.test.ts` (7 new test files should exist).
   - `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3` (should print `Results: 98 passed, 0 failed`).
   - `for t in blight cloudkill disintegrate harm finger_of_death sunburst power_word_kill; do npx ts-node --transpile-only src/test/${t}.test.ts | tail -2; done` (all 7 should print `Results: N passed, 0 failed`).
3. **DECISION POINT for Session 24:**
   - **(0) 🔴 RECOMMENDED: Run the megabatch** — see `MEGABATCH-MIGRATION-PLAN.md` (committed in this session's post-session work). The megabatch covers all 124 migratable spells across 4 batches (Cantrip-24 through Cantrip-27). Each batch is one overnight long-running task run. The per-spell specs in the plan supersede the ad-hoc recommendations below.
   - (a) **Continue real-mechanics migration with batch 3** — give more Session 19/20 bulk-implemented spells REAL mechanical effects. Recommended next batch (high-damage AoE / multi-target):
     - **Chain Lightning** (L6) — DEX save 10d8 lightning, multi-target (4 targets). NEW multi-target single-save pattern (each target makes its own save, but all are explicit targets — not an AoE).
     - **Otiluke's Freezing Sphere** (L6) — DEX save 10d6 cold 60-ft radius AoE. Mirrors Fireball (radius AoE save) with cold damage.
     - **Delayed Blast Fireball** (L7) — DEX save 12d6 fire 20-ft radius AoE + delayed-detonation mechanic. NEW delayed-detonation pattern (needs a "deferred effect" hook — could simplify to instant-cast with +1d6/round-up-to-5 bonus).
     - **Prismatic Spray** (L8) — 8-ray random-effect table. NEW random-effect-table pattern (roll 1d8 per target — each ray has different damage/condition).
     - **Earthquake** (L8) — multi-effect terrain (difficult terrain + structures + fissures). Likely a blocker (terrain subsystem).
     - **Meteor Swarm** (L9) — DEX save 20d6 fire + 20d6 bludgeoning in 40-ft radius AoE, 4 impact points. Mirrors Fireball (radius AoE save) with dual damage type + 4 AoE points (NEW multi-impact-AoE pattern — could simplify to a single 40-ft radius).
     - **Wish** (L9) — universal. Likely a blocker (no general spell-duplication subsystem).
   - (b) **Coordinate with Core Engine** on the 109+14=123 blocker spells (TG-006 through TG-011). Biggest blockers: TG-006 Summon (38 spells — Session 21 produced a 4-phase plan in `TG-006-SUMMON-PLAN.md`), TG-011 Complex mechanics (28 spells), TG-010 computeLOS (18 spells).
   - (c) **Migrate Cure Wounds** to a dedicated module (mirror Session 44's Healing Word migration) — but coordinate with Core Engine first since they may have plans for it.
   - (d) **Implement the max-HP-reduction field** on Combatant (to make Harm's rider real) — would unblock the max-HP-reduction mechanic for future spells (e.g. Shadow of Moil's temp-HP interaction).
4. If continuing the real-mechanics migration (option a), follow the Session 22/23 architecture:
   - For AoE save spells: mirror `shatter.ts` (radius) or `burning_hands.ts` (cone) or `lightning_bolt.ts` (line — uses `inLineFt`) or `fireball.ts` (big radius) or `cloudkill.ts` (Session 23 radius) or `sunburst.ts` (Session 23 radius + condition_apply).
   - For single-target save spells: mirror `catapult.ts` or `blight.ts` (Session 23) or `harm.ts` (Session 23).
   - For single-target save spells with flat bonus: mirror `disintegrate.ts` (Session 23, +40) or `finger_of_death.ts` (Session 23, +30).
   - For HP-check instakill spells: mirror `power_word_kill.ts` (Session 23 — first of its kind).
   - For each migrated spell: (1) Rewrite the spell module with real `shouldCast` + `execute` + `cleanup`. (2) Add a case branch in `combat.ts`. (3) Add a planner branch in `planner.ts`. (4) Add the type to `PlannedAction.type` union in `core.ts`. (5) Remove the spell from `_generic_registry.ts` (use `scripts/remove_migrated_spells_s23.py` as a template — update the SPELLS list). (6) Write a test file. (7) Update `bulk_spell_dispatch.test.ts` if the spell was a sample.
5. `npx tsc --noEmit` + run the full regression suite (must stay green).
6. `npm run spell-cache:build` — confirm the migrated spells still show `implemented: true` (the count stays at 420 — the migration is qualitative).
7. Commit with message format `Cantrip-24: <summary>`.
8. Write `zHANDOVER-SESSION-24.md`.
9. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (after this session — Session 23)

- `src/test/bulk_spell_dispatch.test.ts`: 98/98 (UPDATED from 91/91).
- 7 new Session 23 spell tests: 256/256 total (blight 33, cloudkill 33, disintegrate 36, harm 28, finger_of_death 32, sunburst 46, power_word_kill 48).
- 7 Session 22 spell tests still green: 272/272 (fireball 34, lightning_bolt 38, cone_of_cold 37, inflict_wounds 32, chromatic_orb 41, catapult 33, ice_knife 57).
- All prior bespoke + engine tests still green (healing_word, healing_spells, bless, burning_hands, magic_missile, shield_simple, sleep, arcane_lock, moonbeam, darkvision, combat, shatter, scorching_ray, summons).
- `tsc --noEmit`: 0 errors (excluding pre-existing TS7006 implicit-any in test files).
- Spell cache: 420/557 implemented (unchanged from Session 20 — migration is qualitative).

---

## NOTES FOR NEXT AGENT

- **Session 23 was the SECOND real-mechanics migration session.** 7 high-damage spells L4-9 migrated from forward-compat flags to bespoke implementations with REAL mechanical effects. The work reused Session 22's bespoke infrastructure (Catapult/Shatter/Fireball patterns) PLUS introduced TWO new mechanics: (1) flat damage bonus on save spells (Disintegrate +40, Finger of Death +30), and (2) HP-check instakill pattern (Power Word Kill — no save, no attack).
- **The migration pattern is now well-established across 14 spells (Session 22's 7 + Session 23's 7).** To migrate a generic spell to a bespoke implementation: (1) Rewrite the spell module with real `shouldCast` + `execute` + `cleanup` (mirror the appropriate Session 22/23 spell). (2) Add a case branch in `combat.ts`. (3) Add a planner branch in `planner.ts` (mirror the Session 22/23 planner branches — 12A through 12N). (4) Add the type to `PlannedAction.type` union in `core.ts`. (5) Remove the spell from `_generic_registry.ts` using `scripts/remove_migrated_spells_s23.py` as a template (update the SPELLS list). (6) Write a test file. (7) Update `bulk_spell_dispatch.test.ts` if the spell was a sample.
- **Cure Wounds is still a known gap.** It has existing `spellHealPlan` infrastructure (not a dedicated module, not a generic-dispatch spell). Core Engine may migrate it. Do NOT implement it without coordinating with Core Engine first.
- **The 7 Session 23 migrated spells are NO LONGER in the generic registry.** `lookupGenericSpell('Blight')` etc. now return `null`. The `bulk_spell_dispatch.test.ts` section 1c verifies this. The current bulk-test sample spells (post-Session 23) are: Alarm L1, Continual Flame L2, Fear L3, Polymorph L4, Hold Monster L5, Globe of Invulnerability L6, Forcecage L7, Feeblemind L8, Time Stop L9.
- **The 7 Session 23 migrated spells come FIRST in the planner's tactical priority** (sections 12H-12N, sitting ABOVE the Session 22 branches 12A-12G AND the Session 19 generic spell loop). Tactical priority order: L9 Power Word Kill (instakill) > L8 Sunburst (12d6 AoE + blindness) > L7 Finger of Death (7d8+30) > L6 Disintegrate (10d6+40, kill-shot bias) > L6 Harm (14d6) > L5 Cloudkill (5d8 AoE) > L4 Blight (8d8). A caster with multiple migrated spells in their action list will prefer the higher-priority spell.
- **Power Word Kill is the FIRST spell in v1 with NO save AND NO attack roll.** Its shouldCast gates on the target's currentHP (first spell to read currentHP in shouldCast). Its execute() sets HP=0 + isDead (monsters) or isUnconscious (PCs — conservative simplification). The slot is consumed unconditionally (PHB p.266). execute() re-checks the HP gate (target may be healed above 100 between planTurn and executePlannedAction). Future no-save/no-attack spells (e.g. Power Word Stun if migrated) should mirror this pattern.
- **Disintegrate and Finger of Death are the FIRST save spells in v1 with a flat damage bonus.** The `metadata.flatDamageBonus` field is added to the dice total. The bonus IS halved on a successful save (conservative reading — v1 halves the total dice+bonus). The `rollDamage(includeFlat = true)` helper supports inspecting the dice-only total for tests. Future save spells with flat bonuses (e.g. Flame Strike if migrated — has +spellcasting-mod on heal portion only) could reuse this field.
- **Sunburst is the FIRST Session 23 spell with a condition_apply rider.** It mirrors Blindness/Deafness's pattern — `applySpellEffect(target, { effectType: 'condition_apply', payload: { condition: 'blinded' }, sourceIsConcentration: false })`. A skip-if-already-blinded guard prevents double-applying. The blindness persists for the entire v1 combat (1-min duration not tracked — same gap as Blindness/Deafness). Future spells with condition riders (e.g. Prismatic Spray's poison ray) should mirror this pattern.
- **Cloudkill's damage is 5d8, NOT 8d8.** The Session 22 handover recommended "Cloudkill (L5 — CON save 8d6 poison)" but that was a typo (both the dice count AND the dice sides were wrong). PHB p.222 says 5d8 poison (confirmed by SAC v2.7 and the SPELL_DB entry). v1 uses 5d8. The `cloudkillDamage5d8Not8d8` metadata flag documents this.
- **The 14 L1 blockers are still documented in TEAMGOALS.md TG-006 through TG-011** — no new TG entries were added in Session 23.
- **Commit message convention:** `Cantrip-N: <summary>`. Session 23 should be `Cantrip-23: Real-mechanics migration batch 2 — 7 high-damage spells L4-9`.
- **All `Combatant` scratch fields added across Sessions 7–23:** (unchanged from Session 22 — no new fields in Session 23). The `_genericSpellActiveSpells?: Set<string>` field from Session 19 now covers 299 bulk-implemented spells (was 306 — 7 migrated to bespoke in Session 23).
- **SpellEffectType registry (unchanged from Session 18):** `advantage_vs`, `ac_bonus`, `ac_floor`, `bless_die`, `condition_apply`, `hex_damage`, `damage_zone`, `weapon_enchant`, `enlarge_reduce`. **Session 23 added NONE.** (Sunburst reuses the existing `condition_apply` effect type for its blinded rider.)
- **ActiveEffect.payload fields (unchanged from Session 18):** (same as Session 22). **Session 23 added NONE.**
- **Architecture summary (Session 23):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (uniform template — all 7 migrated spells use the same shape). NEW: `metadata.flatDamageBonus` (Disintegrate, Finger of Death) and `metadata.hpThreshold` (Power Word Kill).
  - Type changes: 7 new types in `PlannedAction.type` union (additive).
  - Engine: 7 new case branches in `executePlannedAction` (additive).
  - Movement: NO new helpers (reused `chebyshev3D`, `livingEnemiesOf`).
  - Active-effect: NO new effect types or sentinel cases (Sunburst reuses `condition_apply`).
  - Spell DB: NO changes (existing entries from Session 19 still correct — 3 known discrepancies documented in each spell module's forward-compat flags).
  - AI planner: 7 new branches (12H-12N) with tactical priority ordering (additive, sits ABOVE the Session 22 branches 12A-12G and the generic spell loop).
  - Tests: 7 new test files (256 new assertions) + UPDATED `bulk_spell_dispatch.test.ts` (98/98, was 91/91).
- **Implementation milestones (cumulative):**
  - Session 19: FIRST BULK IMPLEMENTATION session (262 L2-9 spells)
  - Session 19: FIRST generic dispatch infrastructure
  - Session 20: SECOND BULK IMPLEMENTATION session (51 L1 spells — backfill)
  - Session 20: Spell cache crossed 75% implementation milestone (420/557 = 75%)
  - Session 21: TG-006 SUMMON-PLAN research document (no code changes)
  - Session 22: FIRST REAL-MECHANICS MIGRATION session (7 combat damage spells L1-5)
  - Session 22: First NEW engine helper since Session 18 (`inLineFt` in movement.ts)
  - Session 22: First HYBRID spell in v1 (Ice Knife — attack roll + AoE save)
  - Session 22: First smart-damage-type-choice heuristic (`pickDamageType` in chromatic_orb.ts)
  - Session 23: SECOND REAL-MECHANICS MIGRATION session (7 high-damage spells L4-9)
  - Session 23: First FLAT DAMAGE BONUS on save spells (`flatDamageBonus` field — Disintegrate +40, Finger of Death +30)
  - Session 23: First HP-CHECK INSTAKILL pattern (Power Word Kill — no save, no attack, pure HP gate)
  - Session 23: First spell to gate shouldCast on target's currentHP (Power Word Kill)
  - Session 23: First spell with a condition_apply rider among the migrated batch (Sunburst — blinded on failed save, mirroring Blindness/Deafness)

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
