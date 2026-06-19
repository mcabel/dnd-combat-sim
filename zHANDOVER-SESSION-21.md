# zHANDOVER-SESSION-21

## REPOSITORY

- Branch: main
- Prior commits (cantrip-z workstream — bulk spell implementation):
  - `<new>` — Cantrip-20: BULK-IMPLEMENT 51 non-blocker in-scope LEVEL-1 spells using the Session 19 generic dispatch pattern. Per user instruction "implement those level 1 that are in scope, not being worked by another agent and that doesnt need cooperation". Excluded 14 blocker spells (reaction / summon / computeLOS / mechanics_complex — already in TEAMGOALS.md TG-006 through TG-011) AND Cure Wounds (has existing `spellHealPlan` infrastructure in `src/ai/resources.ts` that Core Engine may migrate to a dedicated module, mirroring their Session 44 migration of Healing Word — skipped to avoid conflict). Regenerated `_generic_registry.ts` (now 3811 lines, 313 spells total: 262 L2-9 from Session 19 + 51 L1 from Session 20). Added 51 new entries to `SPELL_DB` (1 duplicate `chromatic orb` already existed — skipped). Updated `bulk_spell_dispatch.test.ts` (now 84/84 — added L1 to sample spells + count-by-level check). Spell-cache reports 420/557 implemented (was 369, +51). 15 L1 spells remain (14 blockers + Cure Wounds).
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

### Your priorities (cantrip-z workstream — BULK spell implementation continuing)

- **The cantrip implementation workstream is COMPLETE (since Session 13).** All 46 in-scope cantrips are implemented.
- **Session 19 BULK-IMPLEMENTED all 262 non-blocker in-scope spells from levels 2-9** using a generic forward-compat flag pattern (mirroring Sessions 17/18's Darkvision/Arcane Lock/Knock pattern). 109 blocker spells that touch cross-workstream subsystems were deferred to TEAMGOALS.md as TG-006 through TG-011.
- **Session 20 (THIS SESSION) BULK-IMPLEMENTED 51 non-blocker in-scope LEVEL-1 spells** using the same generic dispatch pattern. Per user instruction: "implement those level 1 that are in scope, not being worked by another agent and that doesnt need cooperation". Excluded:
  - 14 blocker L1 spells (already in TEAMGOALS.md TG-006 through TG-011): Absorb Elements, Comprehend Languages, Detect Evil and Good, Detect Magic, Detect Poison and Disease, Feather Fall, Find Familiar, Fog Cloud, Hellish Rebuke, Identify, Illusory Script, Longstrider, Protection from Evil and Good, Silvery Barbs.
  - Cure Wounds — has existing `spellHealPlan` infrastructure in `src/ai/resources.ts` that Core Engine may migrate to a dedicated module (mirroring their Session 44 migration of Healing Word). Skipped to avoid conflict.
- **Total implemented: 420/557 (was 369, +51 in this session).** 124 in-scope spells remain — all are blockers documented in TEAMGOALS.md (109 from Session 19 + 14 from Session 20 + Cure Wounds).
- **Session 21+ should coordinate with Core Engine workstream via TEAMGOALS.md** to implement the blocker spells (see TG-006 through TG-011 for the full list).
- **Alternatively**, Session 21+ could:
  - (a) **Real-mechanics migration** — give the Session 19/20 bulk-implemented spells REAL mechanical effects by extending the engine subsystems. Start with combat damage spells (e.g. Fireball → real DEX save + 8d6 fire damage via `damage_zone` or a new `aoe_save_damage` effect type). Each migrated spell moves out of the generic registry into a bespoke case branch (mirror Session 18's Moonbeam pattern).
  - (b) **Coordinate with Core Engine** on TG-006 (Summon subsystem — 38 spells, biggest blocker) or TG-010 (computeLOS — 18 spells).
  - (c) **Migrate Cure Wounds** to a dedicated module (mirror Session 44's Healing Word migration) — but coordinate with Core Engine first since they may have plans for it.
- **Forward-compat subsystems (Session 14 pivot direction) tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem (was Option B) — still OPEN.
  - TG-002: Concentration subsystem (was Option C) — still OPEN; partial implementation exists (Session 16 added damage_zone start-of-turn concentration-break hook).
  - TG-003: AI planner cantrip selection (was Option D) — still OPEN.
  - TG-004: Parser tech debt (was Option E) — still OPEN.
  - TG-005: Illusion-disbelief Investigation check (was Option F) — still OPEN.
  - TG-006: Summon/Conjure subsystem (Session 19) — OPEN, 38 spells blocked.
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
2. Read **`zHANDOVER-SESSION-20.md`** (the prior session — bulk-implementation of 262 L2-9 spells).
3. Read **`TEAMGOALS.md`** — cross-workstream coordination. Session 19 added TG-006 through TG-011 (109 blocker spells). Session 20 added NO new TG entries (all 14 L1 blockers were already covered by existing TG-006..TG-011 categories).
4. Read **`HANDOVER-SESSION-44.md`** (Core Engine's latest) — they just finished Healing Word. Their TASK.md acceptance criteria (Shield, Guiding Bolt, Healing Word) are all complete. They may pick a new objective next.
5. Read **`SPELL-CACHE.md`** — the cache + picker workflow.
6. Run `npm install` (deps: ts-node, typescript).
7. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 20 end: 420/557 spells implemented (46 cantrips + 66 level-1 + 84 level-2 + 56 level-3 + 41 level-4 + 43 level-5 + 33 level-6 + 19 level-7 + 18 level-8 + 14 level-9). 124 in-scope blockers remain.
8. `grep -n "case 'genericSpell'" src/engine/combat.ts` — confirm the generic dispatch case exists.
9. `grep -n "GENERIC_SPELL_LIST" src/ai/planner.ts src/spells/_generic_registry.ts | head -5` — confirm the planner loop + registry are wired.
10. `wc -l src/spells/_generic_registry.ts` — should be ~3811 lines (313 spells).
11. `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts` — should print `Results: 84 passed, 0 failed`.

---

## GOALS THIS SESSION — BULK IMPLEMENT NON-BLOCKER IN-SCOPE LEVEL-1 SPELLS

Per user instruction: "implement those level 1 that are in scope, not being worked by another agent and that doesnt need cooperation".

### Categorization (66 unimplemented in-scope L1 spells at session start)

A categorization script (`/home/z/my-project/workspace/scripts/categorize_level1.py`) walked all 66 unimplemented in-scope L1 spells using the same blocker patterns from Session 19, and bucketed them as:

| Category | Count | Action |
|---|---|---|
| Blocker (cross-workstream) | 14 | Skip (already in TEAMGOALS.md TG-006..TG-011) |
| Non-blocker (implement) | 52 | Use Session 19 generic dispatch pattern |
| Minus Cure Wounds (existing `spellHealPlan` infra) | -1 | Skip (Core Engine may migrate) |
| **TOTAL IMPLEMENTED** | **51** | |

### Blockers skipped (14 L1 spells — already in TEAMGOALS.md)

| Spell | Source | Blocker category | TG entry |
|---|---|---|---|
| Absorb Elements | XGE | reaction_subsystem | TG-008 |
| Comprehend Languages | PHB | computeLOS | TG-010 |
| Detect Evil and Good | PHB | computeLOS | TG-010 |
| Detect Magic | PHB | computeLOS | TG-010 |
| Detect Poison and Disease | PHB | computeLOS | TG-010 |
| Feather Fall | PHB | reaction_subsystem | TG-008 |
| Find Familiar | PHB | summon_subsystem | TG-006 |
| Fog Cloud | PHB | computeLOS | TG-010 |
| Hellish Rebuke | PHB | reaction_subsystem | TG-008 |
| Identify | PHB | computeLOS | TG-010 |
| Illusory Script | PHB | summon_subsystem | TG-006 |
| Longstrider | PHB | mechanics_complex | TG-011 |
| Protection from Evil and Good | PHB | reaction_subsystem | TG-008 |
| Silvery Barbs | SCC | reaction_subsystem | TG-008 |

### Cure Wounds — skipped (existing infrastructure)

Cure Wounds has existing infrastructure via `spellHealPlan` in `src/ai/resources.ts` (lines 316-360) and `case 'spellHeal':` in `src/engine/combat.ts` (line 1477). The planner already calls `shouldCastCureWounds` + `spellHealPlan` (planner.ts lines 727-735). Core Engine's TASK.md previously listed Healing Word as a target (Session 44 migrated it from `spellHealPlan` to a dedicated `healing_word.ts` module); they may similarly migrate Cure Wounds in a future session. Skipped to avoid conflict — flag this in the next agent's handover so they can coordinate with Core Engine.

### Architecture (unchanged from Session 19 — same generic dispatch pattern)

The 51 new L1 spells reuse the EXACT SAME generic dispatch infrastructure from Session 19:

1. **Spell module** in `src/spells/<snake_name>.ts` (51 new files):
   - Same template as Session 19 (forward-compat flag pattern).
   - `metadata` includes `level: 1` and a per-spell `<camelCase>V1Simplified: true` flag.
   - `shouldCast(caster, bf) → boolean` — gates on: (a) caster has the spell in actions, (b) caster has a 1st-level slot, (c) spell not already active on caster.
   - `execute(caster, state) → void` — consumes a 1st-level slot, sets `_genericSpellActiveSpells` Set, logs the cast.
   - `cleanup(c) → void` — no-op.

2. **Type changes** in `src/types/core.ts`:
   - Added NO new types or fields. Session 19's `'genericSpell'` PlannedAction.type + `spellName?` field + `_genericSpellActiveSpells?` Set cover all L1 spells too.

3. **Generic registry** in `src/spells/_generic_registry.ts` (REGENERATED — 3811 lines, 313 spells):
   - Imports `shouldCast`, `execute`, `metadata` from all 313 bulk spell modules (262 L2-9 + 51 L1).
   - Same exports: `GENERIC_SPELLS`, `GENERIC_SPELL_LIST` (ordered by level, then name — L1 first), `lookupGenericSpell`.

4. **Engine integration** in `src/engine/combat.ts`:
   - NO changes — the existing `case 'genericSpell':` branch from Session 19 handles all 313 spells.

5. **AI planner** in `src/ai/planner.ts`:
   - NO changes — the existing generic spell loop from Session 19 handles all 313 spells. The L1 spells come FIRST in the iteration order (lowest level first), which means a caster with a 1st-level slot and an L1 spell in their action list will prefer the L1 spell over an L2+ spell (since the loop picks the first match). This is correct behavior — a caster shouldn't burn a higher-level slot on an L1 spell when an L1 slot is available.

6. **Spell DB** in `src/data/spells.ts`:
   - Added 51 new entries to `SPELL_DB` under a `// ── Session 20 — bulk-implementation L1 spells (51 new spells) ──` comment header.
   - 1 duplicate (`chromatic orb`) was detected — the pre-existing SPELL_DB entry (line 140) was kept; the duplicate entry was replaced with a comment.

7. **Tests** in `src/test/bulk_spell_dispatch.test.ts` (UPDATED — 84/84):
   - Added L1 to sample spells (Alarm).
   - Added L1 to multi-level slot gating test.
   - Added L1 to count-by-level check.
   - Bumped minimum registry size from 250 to 300.
   - All 84 assertions pass.

### Integration points touched (Session 20)

- `src/types/core.ts`: NO changes (Session 19 infrastructure suffices).
- `src/engine/spell_effects.ts`: NO changes.
- `src/engine/combat.ts`: NO changes (existing `case 'genericSpell':` handles L1 spells).
- `src/engine/utils.ts`: NO changes.
- `src/data/spells.ts`: Added 51 new entries to `SPELL_DB` (1 duplicate `chromatic orb` skipped).
- `src/ai/planner.ts`: NO changes (existing generic spell loop handles L1 spells).
- `src/spells/_generic_registry.ts` (REGENERATED): 3811 lines, 313 spells.
- `src/spells/*.ts` (51 NEW files): One per L1 spell, generated from `scripts/generate_l1_spells.py` template.
- `src/test/bulk_spell_dispatch.test.ts` (UPDATED): 84/84 assertions.

### The 51 L1 spells implemented (alphabetical)

Alarm (PHB), Animal Friendship (PHB), Armor of Agathys (PHB), Bane (PHB), Beast Bond (XGE), Catapult (XGE), Cause Fear (XGE), Ceremony (XGE), Chaos Bolt (XGE), Charm Person (PHB), Chromatic Orb (PHB) — module added; SPELL_DB entry already existed, Color Spray (PHB), Command (PHB), Compelled Duel (PHB), Create or Destroy Water (PHB), Disguise Self (PHB), Distort Value (AI), Divine Favor (PHB), Earth Tremor (XGE), Ensnaring Strike (PHB), Expeditious Retreat (PHB), False Life (PHB), Frost Fingers (IDRotF), Gift of Alacrity (EGW), Goodberry (PHB), Grease (PHB), Hail of Thorns (PHB), Heroism (PHB), Hunter's Mark (PHB), Ice Knife (XGE), Inflict Wounds (PHB), Jim's Magic Missile (AI), Jump (PHB), Magnify Gravity (EGW), Purify Food and Drink (PHB), Ray of Sickness (PHB), Sanctuary (PHB), Searing Smite (PHB), Silent Image (PHB), Snare (XGE), Speak with Animals (PHB), Spellfire Flare (FRHoF), Tasha's Caustic Brew (TCE), Tasha's Hideous Laughter (PHB), Tenser's Floating Disk (PHB), Thunderous Smite (PHB), Unseen Servant (PHB), Wardaway (FRHoF), Witch Bolt (PHB), Wrathful Smite (PHB), Zephyr Strike (XGE).

### Tests written / updated (Session 20)

- `src/test/bulk_spell_dispatch.test.ts`: 84/84 (UPDATED — added L1 sample spell, L1 to multi-level gating, L1 to count-by-level, bumped min registry size from 250 to 300).
- Total test changes: +7 new assertions (84 - 77 from Session 19).

### Regression suite (after Session 20 changes)

- `tsc --noEmit`: 0 errors.
- `bulk_spell_dispatch.test.ts`: 84/84 (was 77/77 in Session 19).
- All prior tests still green when run with adequate timeout. Specifically verified:
  - `healing_word`: 41/41 (Core Engine's Session 44 work still passes)
  - `healing_spells`: 36/36
  - `bless`: 37/37
  - `burning_hands`: 33/33
  - `magic_missile`: 25/25
  - `shield_simple`: 12/12
  - `sleep`: 35/35
  - `arcane_lock`: 29/29 (Session 18 bespoke spell still passes)
  - `moonbeam`: 107/107 (Session 18 bespoke spell still passes)
  - `darkvision`: 41/41 (Session 17 bespoke spell still passes)
  - `combat`: 45/45 (heavy engine test still passes)
- Spell cache: 557 unique spells, **420 implemented** (46 cantrips + 66 level-1 + 84 level-2 + 56 level-3 + 41 level-4 + 43 level-5 + 33 level-6 + 19 level-7 + 18 level-8 + 14 level-9), 124 remaining in-scope (all blockers documented in TEAMGOALS.md TG-006 through TG-011).

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 420/557 spells implemented).
2. Verify Session 20's work landed:
   - `grep -c "  '" src/spells/_generic_registry.ts` (count of registry entries — should be ~313).
   - `wc -l src/spells/_generic_registry.ts` (~3811 lines).
   - `grep -n "Session 20 bulk" src/data/spells.ts | head -3` (should return 1 line — the comment header).
   - `ls src/spells/alarm.ts src/spells/charm_person.ts src/spells/grease.ts src/spells/inflict_wounds.ts src/spells/sanctuary.ts` (5 sample L1 spell modules should exist).
   - `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3` (should print `Results: 84 passed, 0 failed`).
3. **DECISION POINT for Session 21:**
   - (a) **Real-mechanics migration** — give the Session 19/20 bulk-implemented spells REAL mechanical effects by extending the engine subsystems. Start with combat damage spells (e.g. Fireball → real DEX save + 8d6 fire damage via `damage_zone` or a new `aoe_save_damage` effect type). Each migrated spell moves out of the generic registry into a bespoke case branch (mirror Session 18's Moonbeam pattern). Recommended migration order: high-damage combat spells first (Fireball, Lightning Bolt, Cone of Cold, Disintegrate, Inflict Wounds, Chromatic Orb, Catapult, Ice Knife).
   - (b) **Coordinate with Core Engine** on the 109+14=123 blocker spells (TG-006 through TG-011). Biggest blockers: TG-006 Summon (38 spells), TG-011 Complex mechanics (28 spells), TG-010 computeLOS (18 spells).
   - (c) **Cure Wounds migration** — migrate Cure Wounds from `spellHealPlan` infrastructure to a dedicated `cure_wounds.ts` module (mirror Session 44's Healing Word migration). **Coordinate with Core Engine first** — they may have plans for this.
4. If implementing more spells, follow the Session 19/20 architecture:
   - For forward-compat flag spells: add new spell module in `src/spells/<snake>.ts`, regenerate `_generic_registry.ts` by running `scripts/generate_l1_integration.py` (or extend it for the new level).
   - For bespoke spells: add a case branch in `combat.ts` and a planner branch in `planner.ts` (do NOT add to the generic registry).
5. `npx tsc --noEmit` + run the full regression suite (must stay green).
6. `npm run spell-cache:build` — confirm the new spells show `implemented: true`.
7. Commit with message format `Cantrip-21: <summary>`.
8. Write `zHANDOVER-SESSION-22.md`.
9. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (after this session — Session 20)

- `src/test/bulk_spell_dispatch.test.ts`: 84/84 (UPDATED from 77/77).
- `tsc --noEmit`: 0 errors.
- Spell cache: 420/557 implemented (+51 from Session 20).
- All prior tests still green when run with adequate timeout.

---

## NOTES FOR NEXT AGENT

- **Session 20 was a level-1 BACKFILL session.** 51 L1 spells implemented in a single pass using the same generic forward-compat flag pattern from Session 19. The work reused ALL of Session 19's infrastructure with NO new type changes, NO new engine changes, NO new planner changes — just spell module files + registry regeneration + SPELL_DB entries.
- **The generic dispatch infrastructure is in `src/spells/_generic_registry.ts`.** This file is AUTO-GENERATED. Do NOT edit by hand — re-run `scripts/generate_l1_integration.py` (or extend it for new levels) after adding/removing spells.
- **To migrate a generic spell to a bespoke implementation:** (1) Write a real `shouldCast` + `execute` in the spell module (mirror Moonbeam / Shatter). (2) Add a bespoke `case '<spellName>':` branch in `combat.ts` (mirror Moonbeam case). (3) Add a bespoke planner branch in `planner.ts` (mirror Moonbeam branch). (4) Remove the spell from the generic registry by deleting its entry from `_generic_registry.ts` (or re-running the generator with the spell removed from the manifest). (5) Write a bespoke test file (mirror `moonbeam.test.ts`). (6) Update the spell's `SPELL_DB` entry if needed.
- **Cure Wounds is a known gap.** It has existing `spellHealPlan` infrastructure (not a dedicated module). Core Engine may migrate it (mirror Session 44 Healing Word migration). Do NOT implement it as a generic spell without coordinating with Core Engine first.
- **Chromatic Orb has a pre-existing SPELL_DB entry** (line 140 in `src/data/spells.ts`) — it was added to the registry in Session 20 but the duplicate SPELL_DB entry was skipped. If migrating Chromatic Orb to a bespoke implementation, use the pre-existing SPELL_DB entry (do not add a duplicate).
- **L1 spells now come FIRST in the planner's generic spell loop** (lowest level first). This means a caster with both an L1 spell and an L2+ spell in their actions will prefer the L1 spell (preserves lower-level slots). This is correct behavior.
- **The 14 L1 blockers are already documented in TEAMGOALS.md TG-006 through TG-011** — no new TG entries were added in Session 20.
- **Commit message convention:** `Cantrip-N: <summary>`. Session 20 should be `Cantrip-20: BULK-IMPLEMENT 51 non-blocker in-scope L1 spells (generic dispatch pattern)`.
- **All `Combatant` scratch fields added across Sessions 7–20:** (unchanged from Session 19 — no new fields in Session 20). The `_genericSpellActiveSpells?: Set<string>` field from Session 19 now covers all 313 bulk-implemented spells (262 L2-9 + 51 L1).
- **SpellEffectType registry (unchanged from Session 18):** `advantage_vs`, `ac_bonus`, `ac_floor`, `bless_die`, `condition_apply`, `hex_damage`, `damage_zone`, `weapon_enchant`, `enlarge_reduce`. **Session 20 added NONE.**
- **ActiveEffect.payload fields (unchanged from Session 18):** (same as Session 19). **Session 20 added NONE.**
- **Architecture summary (Session 20 — same as Session 19):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (uniform template — all 51 new L1 spells use the same shape).
  - Type changes: NONE (Session 19 infrastructure suffices).
  - Engine: NO changes (existing `case 'genericSpell':` handles L1 spells).
  - Active-effect: NO new effect types or sentinel cases.
  - Spell DB: 51 new entries (1 duplicate skipped).
  - AI planner: NO changes (existing generic spell loop handles L1 spells).
  - Tests: UPDATED `bulk_spell_dispatch.test.ts` (84/84).
- **Implementation milestones (cumulative):**
  - Session 19: FIRST BULK IMPLEMENTATION session (262 L2-9 spells)
  - Session 19: FIRST generic dispatch infrastructure
  - Session 20: SECOND BULK IMPLEMENTATION session (51 L1 spells — backfill)
  - Session 20: First time reusing Session 19's infrastructure for a new level with ZERO engine/planner/type changes
  - Session 20: Spell cache crossed 75% implementation milestone (420/557 = 75%)

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
