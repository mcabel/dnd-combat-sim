# zHANDOVER-SESSION-16

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `c7e636d` — Cantrip-14: Implement `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot — consumes Guidance + Friends forward-compat scratch flags)
  - `d5660dc` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water (XGE/PHB/GGR) — FINAL cantrip batch
  - `6c185e9` — Cantrip-12: Mage Hand, Prestidigitation, Thaumaturgy, Mending, Message
  - `24d7d0d` — Cantrip-11: Spare the Dying, Guidance, Friends, Light, Minor Illusion
  - `6a7704f` — Cantrip-10: Gust, Primal Savagery, True Strike, Resistance, Magic Stone
  - (see prior handovers for Cantrip-1 through Cantrip-9)
- Commits this session:
  - `<new>` — Cantrip-15: Pivot to Level-2 spells — implement Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite (PHB). Also: create TEAMGOALS.md (cross-workstream coordination file) consolidating TG-001..TG-005 (was Options B/C/D/E/F in zHANDOVER-15).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: user provides in chat each session. do not warn.

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrip-z / Level-2 spells (this agent)** | **THIS agent (you)** |
| `TEAMGOALS.md` | **All three workstreams (shared)** | **ANY agent may append sections — edit only your own** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — coordinate via TEAMGOALS.md |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip-z workstream — PIVOTED AGAIN in Session 15)

- **The cantrip implementation workstream is COMPLETE (since Session 13).** All 46 in-scope cantrips are implemented. There are NO more cantrips to implement.
- **Session 14 PIVOTED to forward-compat subsystems** (Option A — `rollAbilityCheck` choke point in `utils.ts`).
- **Session 15 PIVOTED AGAIN — this time to LEVEL-2 SPELL IMPLEMENTATION.** The user explicitly directed this pivot. The cantrip-z workstream is now implementing PHB level-2 spells using the same cache + picker workflow that was used for cantrips (see `SPELL-CACHE.md`). This crosses the historical workstream boundary (leveled spells were Core Engine territory per AGENTS.md), but the user's handover supersedes AGENTS.md per the PRIORITY RULE.
- **Session 15 also created `TEAMGOALS.md`** at the repo root. This file consolidates cross-workstream tasks that were previously inlined in zHANDOVER-15 as "Options B/C/D/E/F". Each task is now a `TG-NNN` entry with explicit owners, status, and coordination protocol. **Read `TEAMGOALS.md` before starting any cross-workstream task.**
- **Forward-compat subsystems (the Session 14 pivot direction) are now tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem for multi-effect cantrips (was Option B)
  - TG-002: Concentration subsystem (was Option C)
  - TG-003: AI planner cantrip selection (was Option D)
  - TG-004: Parser tech debt (was Option E)
  - TG-005: Illusion-disbelief Investigation check (was Option F)
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- Do NOT touch another workstream's handover files.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-15.md`** (the prior pivot — Option A `rollAbilityCheck`; also documents the original Options B/C/D/E/F that are now in TEAMGOALS.md).
3. Read **`TEAMGOALS.md`** — cross-workstream coordination. ANY task that touches multiple workstreams MUST be a `TG-NNN` entry here. Add new entries (do not delete other agents' entries).
4. Read **`SPELL-CACHE.md`** — the cache + picker workflow. Now applies to ALL spell levels (0–9), not just cantrips.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 15 end: 67/557 spells implemented (46 cantrips + 16 level-1 + 5 level-2 + 0 levels 3–9).
7. `grep -n "export function rollAbilityCheck" src/engine/utils.ts` — confirm the Session 14 choke point exists (line ~242). Should be there from Session 14's commit `c7e636d`.
8. `grep -n "getActiveAcFloor" src/engine/spell_effects.ts` — confirm the Session 15 ac_floor query exists. Should be there from this session's commit.
9. `grep -n "case 'aid'\|case 'barkskin'\|case 'blur'\|case 'blindnessDeafness'\|case 'brandingSmite'" src/engine/combat.ts` — confirm the 5 new level-2 case branches exist.

---

## GOALS THIS SESSION — CONTINUE LEVEL-2 SPELL IMPLEMENTATION

The cantrip-z workstream has PIVOTED to PHB level-2 spells. The first batch (5 spells) landed in Session 15. The next batch should follow the same pattern.

### Architecture established in Session 15 (for level-2 spells)

The level-2 spell pattern mirrors the existing level-1 spell pattern (Bless / Entangle / Faerie Fire / etc.):

1. **Spell module** in `src/spells/<snake_name>.ts`:
   - `export const metadata = { name, level: 2, school, rangeFt, concentration, castingTime, ...metadata flags } as const;`
   - `export function shouldCast(caster, bf) → Combatant | Combatant[] | boolean | null` — planner hook.
   - `export function execute(caster, target/targets/state) → void` — applies the effect.
   - `export function cleanup(c) → void` — for `resetBudget` integration (no-op for concentration spells; safety-net for scratch-flag spells).
   - Metadata flags for v1 simplifications (mirror cantrip pattern, e.g. `aidHPCleanupV1Implemented: false`).

2. **Type changes** in `src/types/core.ts`:
   - Add new `'spellName'` to the `PlannedAction.type` union.
   - Add new `SpellEffectType` if needed (Session 15 added `'ac_floor'` for Barkskin).
   - Add new `payload` field if needed (Session 15 added `acFloor?: number`).
   - Add new scratch field on `Combatant` if needed (Session 15 added `_aidHPBonus?: number` and `_brandingSmiteActive?: boolean`).

3. **Engine integration** in `src/engine/combat.ts`:
   - Import `shouldCast` + `execute` from the new spell module.
   - Add `case 'spellName':` branch in `executePlannedAction` that re-runs `shouldCast` (live target list) and calls `execute`.
   - If the spell modifies a shared computation (e.g. Barkskin's AC floor), update that computation (e.g. `effectiveAC` at line ~397).

4. **Active-effect integration** in `src/engine/spell_effects.ts` (if the spell uses a new effect type):
   - Add the new effect type to the `_undoEffect` switch (usually a no-op "read at resolution time" case).
   - Add a new query function (e.g. `getActiveAcFloor`) consumed by `combat.ts`.

5. **Cleanup integration** in `src/engine/utils.ts` (if the spell uses a scratch flag with 1-round duration):
   - Import the spell's `cleanup` function.
   - Call it from `resetBudget` with a doc comment explaining the v1 1-round simplification.

6. **Spell DB** in `src/data/spells.ts`:
   - Add an entry to `SPELL_DB` keyed by lowercase spell name (e.g. `'aid'`, `'barkskin'`).
   - The parser uses this to create `Action` objects for PCs whose stat block lists the spell as prepared.

7. **AI planner** in `src/ai/planner.ts`:
   - Import `shouldCast` from the new spell module.
   - Add a planner branch (in `planTurn` for action-time spells, in `planBonusAction` for bonus-action spells).
   - Guard with `if (!plan.action)` so the new spell only fires when no higher-priority spell was chosen.
   - Use `self.actions.some(a => a.name === 'Spell Name')` to gate on the caster having the spell.

8. **Tests** in `src/test/<snake_name>.test.ts`:
   - Mirror the `healing_word.test.ts` / `shield_simple.test.ts` pattern.
   - Use `makeCombatant` / `makeBF` / `makeState` helpers.
   - 6–7 sections: 1. Metadata, 2. shouldCast gates, 3. shouldCast target priority, 4. execute mechanics, 5. execute logging, 6. cleanup, 7. Integration pipeline.
   - For probabilistic save outcomes (e.g. Blindness/Deafness), use deterministic save DCs (e.g. CON 1 + DC 25 = guaranteed fail; CON 30 + DC 5 = guaranteed success).

9. **Cache rebuild**: `npm run spell-cache:build` after implementing — confirm the new spells show `implemented: true` in `spell-cache/INDEX.md`.

### Suggested next batch — level-2 spells (PHB), batch 2

Run `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next 5 unimplemented PHB level-2 spells. After Session 15, the next 5 unimplemented PHB level-2 spells (alphabetically) are:

- **Calm Emotions** (PHB p.221) — Enchantment, action, 20-ft sphere, WIS save or charmed/calmed, concentration 1 min. Mirror Entangle's AoE save pattern.
- **Cloud of Daggers** (PHB p.222) — Conjuration, action, 5-ft cube, 4d4 slashing, no save, concentration 1 min. New pattern: persistent damaging AoE.
- **Crown of Madness** (PHB p.229) — Enchantment, action, single target, WIS save or charmed-and-attacks-different-target, concentration 1 min. Mirror Friends' CHA-debuff pattern but with a save.
- **Darkness** (PHB p.230) — Evocation, action, 15-ft radius sphere, blocks vision, concentration 10 min. New pattern: vision-blocking AoE (touches `computeLOS` — coordinate with Core Engine).
- **Darkvision** (PHB p.230) — Transmutation, action, touch, grants darkvision, concentration 8 hr (no, actually no concentration). Mirror Light's touch-effect pattern.

**Pick recommendation for Session 16:** Calm Emotions + Cloud of Daggers + Crown of Madness + Hold Person + Mirror Image (skip Darkness — it touches `computeLOS` and would clash with Core Engine's LOS work; defer to a future session or coordinate via TEAMGOALS.md). These 5 are all single-target or small-AoE, don't touch shared infrastructure, and exercise diverse patterns (save-or-charm, persistent-AoE, save-or-charm-with-attack, save-or-paralyzed, self-mirror-image).

### How to add a new TG-NNN entry

If you discover a NEW cross-workstream task during implementation:

1. Read `TEAMGOALS.md` to find the next free `TG-NNN` number.
2. Use the section template at the bottom of `TEAMGOALS.md`.
3. Set Status to `OPEN`, Owners to your workstream + the reviewer workstream.
4. Commit `TEAMGOALS.md` alongside your code changes.

---

## COMPLETED THIS SESSION (Session 15)

### Feature 1: TEAMGOALS.md — cross-workstream coordination file (NEW)

Created `TEAMGOALS.md` at the repo root. Consolidates 5 cross-workstream tasks that were previously inlined in `zHANDOVER-SESSION-15.md` as "Options B/C/D/E/F":

- **TG-001: Persistent-buff subsystem for multi-effect cantrips** (was Option B). Owners: Cantrip-z (driving) + Core Engine (Combatant type review). 5 cantrips affected.
- **TG-002: Concentration subsystem** (was Option C). Owners: Core Engine (driving) + Cantrip-z (Dancing Lights). `concentrationSaveDC` already exists in `utils.ts` but is never called.
- **TG-003: AI planner cantrip selection** (was Option D). Owners: Core Engine (driving). Engine routing works; AI doesn't know WHEN to cast cantrips.
- **TG-004: Parser tech debt** (was Option E). Owners: Core Engine. `hasMetalArmor`, `isUndead`, `isConstruct`, `spellcastingMod`, `casterLevel` — all exist on `Combatant` but aren't populated by the parser.
- **TG-005: Illusion-disbelief Investigation check** (was Option F). Owners: Cantrip-z (driving) + Core Engine (LOS review). Built on Session 14's `rollAbilityCheck`.

`TEAMGOALS.md` also includes:
- Authority order (code > handover > TEAMGOALS > TASK/ROADMAP).
- Maintenance rule (any agent may append; edit only your own).
- Section template for new TG-NNN entries.
- RFC template for proposed field/type shapes (none yet).

### Feature 2: First batch of PHB level-2 spells (5 spells)

Used `npm run spell-cache:pick -- --level 2 --source PHB --count 10` to get the alphabetical list, then picked the first 5 mechanically diverse spells. All 5 implemented with the pattern documented above:

1. **Aid** (`src/spells/aid.ts`, PHB p.211) — 2nd-level abjuration, action, 30 ft, NO concentration, 8 hr.
   - Effect: up to 3 allies gain +5 max HP AND +5 current HP.
   - Pattern: direct `maxHP`/`currentHP` modification (no `ActiveEffect`); `_aidHPBonus` scratch field tracks the bonus for future cleanup/dispel (forward-compat only — v1 never reads it).
   - v1 simplifications: no cleanup (8 hr >> combat); no upcast; no undead/construct exclusion (Aid has none per PHB p.211).
   - Metadata flags: `aidHPCleanupV1Implemented: false`, `aidUpcastV1Implemented: false`.

2. **Barkskin** (`src/spells/barkskin.ts`, PHB p.217) — 2nd-level transmutation, action, touch, concentration 1 hr.
   - Effect: target's AC can't be less than 16.
   - Pattern: new `'ac_floor'` `SpellEffectType` + `payload.acFloor?: number` + `getActiveAcFloor(c)` query. `combat.ts:397` updated: `effectiveAC = max(natural AC, ac_floor) + ac_bonus + wardingBond + cover`.
   - v1 simplifications: concentration NOT enforced (TG-002); willing-creature check skipped (any same-faction ally is valid).
   - Metadata flag: `barkskinConcentrationEnforcementV1Implemented: false`.

3. **Blur** (`src/spells/blur.ts`, PHB p.219) — 2nd-level illusion, action, self, concentration 1 min.
   - Effect: disadvantage on attack rolls vs caster.
   - Pattern: existing `advantage_vs` effect type with `advType: 'disadvantage'`, `advScope: 'attack'`. NO engine changes needed — `advantage_vs` already wires into `grantVulnerability` consumed by `attackAdvantageState`.
   - v1 simplifications: concentration NOT enforced (TG-002); sight-dependency immunity (blindsight/truesight) NOT modelled (needs `isBlindImmune` flag — TG-004).
   - Metadata flags: `blurConcentrationEnforcementV1Implemented: false`, `blurSightDependencyV1Implemented: false`.

4. **Blindness/Deafness** (`src/spells/blindness_deafness.ts`, PHB p.219) — 2nd-level necromancy, action, 30 ft, **NO concentration** (unusual!), 1 min.
   - Effect: CON save or blinded (v1 always picks blinded — more combat-relevant than deafened).
   - Pattern: existing `condition_apply` effect with `condition: 'blinded'`. **`sourceIsConcentration: false`** — the condition persists even if the caster is incapacitated or breaks concentration on another spell. `blinded` is already integrated into `attackAdvantageState` in `utils.ts`.
   - v1 simplifications: 1-min duration NOT tracked (persists for combat); end-of-turn CON save NOT modelled (PHB p.219: "At the end of each of its turns, the target can make a new Constitution saving throw"); caster choice (blinded vs deafened) hardcoded to blinded; no upcast.
   - Metadata flags: `blindnessDeafnessDurationV1Simplified: true`, `blindnessDeafnessEndOfTurnSaveV1Implemented: false`, `blindnessDeafnessUpcastV1Implemented: false`.

5. **Branding Smite** (`src/spells/branding_smite.ts`, PHB p.219) — 2nd-level evocation, **bonus action**, self, concentration 1 min.
   - Effect: next weapon hit (melee OR ranged, NOT spell) deals +2d6 radiant.
   - Pattern: new `_brandingSmiteActive?: boolean` scratch field on `Combatant`. Set on cast; consumed by `resolveAttack`'s damage branch on the next weapon hit (mirrors Shillelagh's +1d8 radiant pattern but one-shot instead of persistent). Cleanup at start of next turn via `resetBudget` (v1 1-round simplification).
   - v1 simplifications: duration 1-min concentration → 1-round scratch flag (mirror True Strike / Blade Ward / Shillelagh); concentration NOT enforced (TG-002); invisibility suppression NOT modelled (no invisibility subsystem); no upcast.
   - Metadata flags: `brandingsmiteDurationV1Simplified: true`, `brandingsmiteConcentrationEnforcementV1Implemented: false`, `brandingsmiteInvisibilitySuppressionV1Implemented: false`, `brandingsmiteUpcastV1Implemented: false`.

### Integration points touched (Session 15)

- `src/types/core.ts`:
  - Added `'ac_floor'` to `SpellEffectType`.
  - Added `acFloor?: number` to `ActiveEffect.payload`.
  - Added 5 new types to `PlannedAction.type` union: `'aid'`, `'barkskin'`, `'blur'`, `'blindnessDeafness'`, `'brandingSmite'`.
  - Added 2 new scratch fields on `Combatant`: `_aidHPBonus?: number` (forward-compat only), `_brandingSmiteActive?: boolean` (consumed by `resolveAttack`).
- `src/engine/spell_effects.ts`:
  - Added `'ac_floor'` cases to `applySpellEffect` + `_undoEffect` (no-op "read at resolution time" pattern).
  - Added `getActiveAcFloor(c: Combatant): number` query function (highest floor wins — mirror `getActiveBlessDie`'s max-roll semantics).
- `src/engine/combat.ts`:
  - Imported 5 new spell modules (`aid`, `barkskin`, `blur`, `blindness_deafness`, `branding_smite`).
  - Imported `getActiveAcFloor` from `spell_effects`.
  - Updated `effectiveAC` computation at line ~397: `naturalAC = max(target.ac, acFloor); effectiveAC = naturalAC + wardingBond + cover + acBonus`.
  - Added Branding Smite damage integration in `resolveAttack`'s damage branch (after Shillelagh, before Hex): if `_brandingSmiteActive && (melee|ranged)`, roll 2d6 radiant (4d6 on crit), add to `dmg`, consume the flag.
  - Added 5 new case branches in `executePlannedAction`: `'aid'`, `'barkskin'`, `'blur'`, `'blindnessDeafness'`, `'brandingSmite'`.
- `src/engine/utils.ts`:
  - Imported `cleanupBrandingSmite` from `branding_smite`.
  - Called `cleanupBrandingSmite(c)` from `resetBudget` (after `cleanupMending`, before the budget reset). Doc comment explains the v1 1-round simplification.
- `src/data/spells.ts`:
  - Added 5 new entries to `SPELL_DB`: `'aid'`, `'barkskin'`, `'blur'`, `'blindness/deafness'`, `'branding smite'`. Each has `slotLevel: 2` and appropriate `attackType`/`saveAbility`/`requiresConcentration`/`bonusAction` fields.
- `src/ai/planner.ts`:
  - Imported `shouldCast` from all 5 new spell modules.
  - Added Branding Smite branch in `planBonusAction` (section 2.8, after Shield of Faith, before Bardic Inspiration). Bonus-action self-buff; fires before the main-action weapon attack on the same turn.
  - Added 4 action-time spell branches in `planTurn` (section 11A-11D, after Magic Missile, before Mage Armor):
    - 11A: Aid (multi-ally HP buff, no concentration — fires freely).
    - 11B: Barkskin (single-ally touch AC floor, concentration).
    - 11C: Blindness/Deafness (single-target debuff, NO concentration).
    - 11D: Blur (self-buff, concentration — lowest priority of the 4).
  - All 4 branches guarded by `if (!plan.action)` so they only fire when no higher-priority spell was chosen.

### Tests written (Session 15)

- `src/test/aid.test.ts`: 43/43 (metadata, shouldCast gates + priority, execute HP modifications + slot + `_aidHPBonus`, dead-ally skip, logging, integration pipeline).
- `src/test/barkskin.test.ts`: 38/38 (metadata, shouldCast gates + priority, execute effect application + slot + concentration + stale-cleanup, logging, cleanup no-op, integration pipeline).
- `src/test/blur.test.ts`: 32/32 (metadata, shouldCast gates, execute effect application + slot + concentration + stale-cleanup, logging, cleanup no-op, integration pipeline).
- `src/test/blindness_deafness.test.ts`: 37/37 (metadata, shouldCast gates + priority + non-concentration-invariant, execute save resolution + condition application + slot + no-concentration, logging, cleanup no-op, integration pipeline). Uses deterministic save DCs (CON 1 + DC 25 = guaranteed fail; CON 30 + DC 5 = guaranteed success) to avoid probabilistic flakiness.
- `src/test/branding_smite.test.ts`: 44/44 (metadata, shouldCast gates + weapon-attack-required, execute scratch flag + slot + logging, cleanup flag clearing, resolveAttack damage integration simulated, integration pipeline).
- Total new tests: 194.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 67/557 spells implemented; 5 new level-2 spells show `implemented: true`).
2. Verify Session 15's work landed:
   - `grep -n "getActiveAcFloor" src/engine/spell_effects.ts` (should return ~line 177).
   - `grep -n "case 'aid'\|case 'barkskin'\|case 'blur'\|case 'blindnessDeafness'\|case 'brandingSmite'" src/engine/combat.ts` (should return 5 lines).
   - `grep -n "_brandingSmiteActive" src/engine/combat.ts` (should return 2 lines — the damage integration).
3. Run the new test files: `npx ts-node --transpile-only src/test/{aid,barkskin,blur,blindness_deafness,branding_smite}.test.ts`. All 5 should print `Results: N passed, 0 failed`.
4. Pick the next batch of level-2 spells: `npm run spell-cache:pick -- --level 2 --source PHB --count 5`. Suggested: Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image (skip Darkness — touches `computeLOS`, coordinate via TG-005/TEAMGOALS.md).
5. Implement each spell following the architecture established in Session 15 (documented above).
6. `npx tsc --noEmit` + run the full regression suite (must stay green — 94+ test files, all 0 failures except pre-existing flakies).
7. `npm run spell-cache:build` — confirm the new spells show `implemented: true`.
8. Commit with message format `Cantrip-16: <summary>` (continuing the pivot-workstream prefix from Session 14/15).
9. Write `zHANDOVER-SESSION-17.md`.
10. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 15)

- `aid.test.ts`: 43/43 (NEW)
- `barkskin.test.ts`: 38/38 (NEW)
- `blur.test.ts`: 32/32 (NEW)
- `blindness_deafness.test.ts`: 37/37 (NEW)
- `branding_smite.test.ts`: 44/44 (NEW)
- Prior cantrip tests still green: `fire_bolt.test.ts` 43/43, `acid_splash.test.ts` 44/44, `poison_spray.test.ts` 46/46, `vicious_mockery.test.ts` 47/47, `sacred_flame.test.ts` 51/51, `blade_ward.test.ts` 38/38, `chill_touch.test.ts` 38/38, `shocking_grasp.test.ts` 26/26, `thorn_whip.test.ts` 11/11, `eldritch_blast.test.ts` 53/53, `toll_the_dead.test.ts` 61/61, `mind_sliver.test.ts` 48/48, `thunderclap.test.ts` 54/54, `booming_blade.test.ts` 218/218, `frostbite.test.ts` 57/57, `sword_burst.test.ts` 54/54, `sapping_sting.test.ts` 50/50, `lightning_lure.test.ts` 88/88, `green_flame_blade.test.ts` 209/209, `word_of_radiance.test.ts` 58/58, `produce_flame.test.ts` 52/52, `infestation.test.ts` 277/277, `shillelagh.test.ts` 60/60, `create_bonfire.test.ts` 99/99, `gust.test.ts` 74/74, `primal_savagery.test.ts` 57/57, `true_strike.test.ts` 49/49, `resistance.test.ts` 49/49, `magic_stone.test.ts` 61/61, `spare_the_dying.test.ts` 71/71, `light.test.ts` 60/60, `minor_illusion.test.ts` 55/55, `mage_hand.test.ts` 62/62, `prestidigitation.test.ts` 59/59, `thaumaturgy.test.ts` 59/59, `mending.test.ts` 64/64, `message.test.ts` 60/60, `control_flames.test.ts` 86/86, `dancing_lights.test.ts` 102/102, `druidcraft.test.ts` 95/95, `encode_thoughts.test.ts` 103/103, `mold_earth.test.ts` 106/106, `shape_water.test.ts` 118/118
- Prior level-1 tests still green: `bless.test.ts` 37/37, `entangle.test.ts` 30/30, `faerie_fire.test.ts` 29/29, `magic_missile.test.ts` 25/25, `burning_hands.test.ts` 33/33, `sleep.test.ts` 35/35, `thunderwave.test.ts` 25/25, `arms_of_hadar.test.ts` 39/39, `dissonant_whispers.test.ts` 32/32, `shield_simple.test.ts` 12/12, `shield_of_faith.test.ts` 27/27, `mage_armor.test.ts` 21/21, `guiding_bolt.test.ts` 51/51, `healing_word.test.ts` 41/41, `healing_spells.test.ts` 36/36, `hex.test.ts` 27/27, `warding_bond.test.ts` 41/41
- Engine / AI / resources / scenario / etc. still green: `combat.test.ts` 51/51, `ai.test.ts` 26/26, `resources.test.ts` 72/72, `engine.test.ts` 71/71, `spell_effects.test.ts` 23/23, `mechanics.test.ts` 57/57, `concentration_ai.test.ts` 34/34, `cunning_action.test.ts` 53/53, `death_saves.test.ts` 57/57, `los.test.ts` 54/54, `mount.test.ts` 44/44, `mount_redirect.test.ts` 21/21, `parser.test.ts` 101/101, `pc.test.ts` 270/270, `scenario.test.ts` 94/94, `sneak_attack.test.ts` 23/23, `spell_actions.test.ts` 52/52, `summons.test.ts` 51/51, `day.test.ts` 54/54, `phase4.test.ts` 54/54, `integration.test.ts` 26/26, `character_builder.test.ts` 93/93, `character_improvements.test.ts` 51/51, `character_leveler.test.ts` 207/207, `character_storage.test.ts` 74/74, `adv_system.test.ts` 48/48, `bardic_inspiration.test.ts` 27/27, `html_report.test.ts` 36/36, `server.test.ts` 153/153, `healing.test.ts` 34/34
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **67 implemented** (46 cantrips + 16 level-1 + 5 level-2 + 0 levels 3–9), 477 remaining in-scope.
- Pre-existing flaky tests (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work.

---

## NOTES FOR NEXT AGENT

- **The cantrip-z workstream has PIVOTED TWICE.** Session 14: cantrip implementation → forward-compat subsystems (`rollAbilityCheck`). Session 15: forward-compat subsystems → level-2 spell implementation. The forward-compat work (Options B/C/D/E/F) is now tracked in `TEAMGOALS.md` as TG-001..TG-005 — read that file before starting any cross-workstream task.
- **`TEAMGOALS.md` is the single source of truth for cross-workstream coordination.** Per AGENTS.md PRIORITY RULE, the uploaded handover supersedes AGENTS.md. `TEAMGOALS.md` sits below the handover in authority but above `TASK.md`/`ROADMAP.md`. Any agent may append sections (use the template); edit only your own.
- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **The `ac_floor` effect type is NEW in Session 15.** It's the FIRST effect type that modifies a shared computation (`effectiveAC` in `combat.ts`) via a `Math.max` rather than addition. Future AC-related effects should consider whether they're a floor (use `ac_floor`) or a bonus (use `ac_bonus`).
- **The `_brandingSmiteActive` scratch flag is the FIRST one-shot weapon-attack-rider flag.** It mirrors Shillelagh's `_shillelaghActive` but is one-shot (consumed on next weapon hit) instead of persistent (lasts 1 round). Future "next-attack-rider" spells (e.g. a hypothetical "Searing Smite") should follow this pattern.
- **`Blindness/Deafness` is the FIRST non-concentration save-or-condition spell.** Its `condition_apply` effect has `sourceIsConcentration: false`, so the condition persists for the entire combat (v1 simplification — canonically 1 min, with end-of-turn CON save to end early). Future non-concentration debuffs (e.g. Bestow Curse at level 3) should follow this pattern.
- **AI planner integration is now included for level-2 spells.** Unlike cantrips (where AI selection was deferred — TG-003), level-2 spells get planner branches in the same session as implementation. This matches the Core Engine's level-1 spell pattern. Future level-2 spells should follow the same `if (!plan.action)` guard pattern, placed after Magic Missile / before Mage Armor for action-time spells, or after Shield of Faith for bonus-action spells.
- **Commit message convention:** `Cantrip-N: <summary>` (Session 14 was `Cantrip-14: ...rollAbilityCheck...`; Session 15 was `Cantrip-15: Pivot to Level-2 spells...`; Session 16 should be `Cantrip-16: Implement <spell names>`).
- **Pre-existing flaky tests** (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work.
- **Architecture summary (level-2 spell pattern — established Session 15):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (no-op for concentration spells).
  - Type changes: `PlannedAction.type` union + (if new effect type) `SpellEffectType` + `ActiveEffect.payload` + (if scratch flag) `Combatant._<flagName>`.
  - Engine: `combat.ts` case branch + (if shared computation change) `effectiveAC` / `resolveAttack` damage branch + (if scratch flag) `utils.ts` `resetBudget` cleanup call.
  - Active-effect: `spell_effects.ts` (if new effect type) `_undoEffect` no-op case + query function.
  - Spell DB: `data/spells.ts` `SPELL_DB` entry.
  - AI planner: `planner.ts` branch in `planTurn` (action) or `planBonusAction` (bonus action).
  - Tests: `test/<snake_name>.test.ts` mirroring `healing_word.test.ts` pattern.
- **All `Combatant` scratch fields added across Sessions 7–15:** (Session 14 list, plus Session 15 additions) `_mindSliverDiePenaltyNextSave?`, `_viciousMockeryDisadvNextAttack?`, `_frostbiteDisadvNextWeaponAttack?`, `_boomingBladePendingDamageDice?`, `_chillTouchNoHealing?` + `_chillTouchUndeadDisadv?`, `_rayOfFrostSpeedReduction?`, `_thornWhipPullPending?`, `_infestationMovePending?`, `_shockingGraspNoReaction?`, `_sappingStingProneApplied?`, `_lightningLurePullPending?`, `_greenFlameBladeSplashPending?`, `_gustPushPending?`, `_shillelaghActive?`, `_trueStrikeAdvNextAttack?`, `_resistanceDieBonusNextSave?`, `_guidanceDieBonusNextAbilityCheck?`, `_friendsAdvNextChaCheck?`, `_lightSourceActive?`, `_isStabilized?`, `_mended?`, **`_aidHPBonus?` (Session 15 — NEW, forward-compat only)**, **`_brandingSmiteActive?` (Session 15 — NEW, consumed by `resolveAttack`)**. Optional with sensible defaults.
- **SpellEffectType registry (updated Session 15):** `advantage_vs`, `ac_bonus`, **`ac_floor` (Session 15 — NEW)**, `bless_die`, `condition_apply`, `hex_damage`. The `ac_floor` effect is the first to use `Math.max` semantics (vs `ac_bonus`'s additive semantics).
- **ActiveEffect.payload fields (updated Session 15):** `advType?`, `advScope?`, `acBonus?`, **`acFloor?` (Session 15 — NEW)**, `dieSides?`, `condition?`, `hexDie?`.
- **FIRST level-2 spell milestones (cumulative, for the next agent's reference):**
  - Session 15: FIRST level-2 spell batch (Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite)
  - Session 15: FIRST `ac_floor` `SpellEffectType` (Barkskin — `Math.max` semantics, vs `ac_bonus`'s additive semantics)
  - Session 15: FIRST non-concentration save-or-condition spell (Blindness/Deafness — `sourceIsConcentration: false`)
  - Session 15: FIRST one-shot weapon-attack-rider scratch flag (`_brandingSmiteActive` — mirror Shillelagh's persistent `_shillelaghActive` but one-shot)
  - Session 15: FIRST cross-workstream coordination file (`TEAMGOALS.md` — consolidates TG-001..TG-005, was Options B/C/D/E/F in zHANDOVER-15)
  - Session 15: FIRST workstream-pivot to level-2 spells (cantrip-z workstream now implements PHB level-2 spells using the cache + picker workflow)
- **CANTRIP IMPLEMENTATION WORKSTREAM IS COMPLETE.** All 46 in-scope cantrips implemented (Session 13). Session 14 pivoted to forward-compat subsystems (`rollAbilityCheck` — Option A, DONE). Session 15 pivoted again to level-2 spell implementation (5 PHB level-2 spells, DONE) AND created `TEAMGOALS.md` (consolidates the remaining forward-compat Options B/C/D/E/F as TG-001..TG-005). Session 16+ should continue level-2 spell implementation.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
