# zHANDOVER-SESSION-17

## REPOSITORY

- Branch: main
- Prior commits (cantrip-z workstream — level-2 spell pivot):
  - `39594ad` — Cantrip-15: Pivot to Level-2 spells — implement Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite (PHB). Also: create TEAMGOALS.md.
  - `c7e636d` — Cantrip-14: Implement `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot).
  - `d5660dc` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water — FINAL cantrip batch.
  - (see `zHandoversOld/` for Cantrip-1 through Cantrip-12)
- Commits this session:
  - `<new>` — Cantrip-16: Implement Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image (PHB level-2 batch 2). Also: new `damage_zone` SpellEffectType + start-of-turn damage tick in runCombat; new `_mirrorImageDuplicates` scratch field + retargeting hook in resolveAttack.
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

### Your priorities (cantrip-z workstream — CONTINUING level-2 spells in Session 17)

- **The cantrip implementation workstream is COMPLETE (since Session 13).** All 46 in-scope cantrips are implemented. There are NO more cantrips to implement.
- **Session 14 PIVOTED to forward-compat subsystems** (Option A — `rollAbilityCheck` choke point in `utils.ts`).
- **Session 15 PIVOTED to LEVEL-2 SPELL IMPLEMENTATION** (first batch: Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite). Also created `TEAMGOALS.md`.
- **Session 16 (this session) CONTINUED level-2 spell implementation** (second batch: Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image). 5 new PHB level-2 spells, total 10 level-2 spells now implemented.
- **Session 17+ should continue level-2 spell implementation.** Use `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next batch. As of Session 16 end: 72/557 spells implemented (46 cantrips + 16 level-1 + 10 level-2 + 0 levels 3–9).
- **Forward-compat subsystems (the Session 14 pivot direction) are tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem for multi-effect cantrips (was Option B)
  - TG-002: Concentration subsystem (was Option C) — **NOTE: Session 16 added a concentration-check hook in the damage_zone start-of-turn tick (combat.ts runCombat loop). This is a PARTIAL implementation of TG-002 — it only fires when a damage_zone ticks, not on all damage. The full TG-002 implementation still needs a damage-taken hook in `applyDamage`/`applyDamageWithTempHP`.**
  - TG-003: AI planner cantrip selection (was Option D)
  - TG-004: Parser tech debt (was Option E) — **NOTE: Session 16's Mirror Image sight-dependency immunity (`mirrorImageSightDependencyV1Implemented: false`) and Hold Person / Crown of Madness humanoid-type checks (`holdPersonHumanoidTypeCheckV1Implemented: false`, `crownOfMadnessHumanoidTypeCheckV1Implemented: false`) are blocked on TG-004.**
  - TG-005: Illusion-disbelief Investigation check (was Option F)
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- Do NOT touch another workstream's handover files.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-16.md`** (the prior session — established the level-2 spell pattern; implemented batch 1: Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite).
3. Read **`TEAMGOALS.md`** — cross-workstream coordination. ANY task that touches multiple workstreams MUST be a `TG-NNN` entry here. Add new entries (do not delete other agents' entries).
4. Read **`SPELL-CACHE.md`** — the cache + picker workflow. Now applies to ALL spell levels (0–9), not just cantrips.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 16 end: 72/557 spells implemented (46 cantrips + 16 level-1 + 10 level-2 + 0 levels 3–9).
7. `grep -n "getActiveDamageZones" src/engine/spell_effects.ts` — confirm the Session 16 damage_zone query exists (line ~227).
8. `grep -n "case 'calmEmotions'\|case 'cloudOfDaggers'\|case 'crownOfMadness'\|case 'holdPerson'\|case 'mirrorImage'" src/engine/combat.ts` — confirm the 5 new level-2 case branches exist.
9. `grep -n "_mirrorImageDuplicates" src/engine/combat.ts` — confirm the Mirror Image retargeting hook exists in resolveAttack (should return ~4 lines: the retargeting check + the duplicate-resolution block).
10. `grep -n "damage_zone" src/engine/combat.ts` — confirm the damage_zone start-of-turn tick exists in the runCombat loop (should return ~2 lines: the comment + the `getActiveDamageZones` call).

---

## GOALS THIS SESSION — CONTINUE LEVEL-2 SPELL IMPLEMENTATION

The cantrip-z workstream is CONTINUING PHB level-2 spells. The second batch (5 spells) landed in Session 16. The next batch should follow the same pattern.

### Architecture established in Session 15 (for level-2 spells) — UNCHANGED in Session 16

The level-2 spell pattern mirrors the existing level-1 spell pattern (Bless / Entangle / Faerie Fire / etc.):

1. **Spell module** in `src/spells/<snake_name>.ts`:
   - `export const metadata = { name, level: 2, school, rangeFt, concentration, castingTime, ...metadata flags } as const;`
   - `export function shouldCast(caster, bf) → Combatant | Combatant[] | boolean | null` — planner hook.
   - `export function execute(caster, target/targets/state) → void` — applies the effect.
   - `export function cleanup(c) → void` — for `resetBudget` integration (no-op for concentration spells; safety-net for scratch-flag spells).

2. **Type changes** in `src/types/core.ts`:
   - Add new `'spellName'` to the `PlannedAction.type` union.
   - Add new `SpellEffectType` if needed (Session 16 added `'damage_zone'` for Cloud of Daggers).
   - Add new `payload` field if needed (Session 16 added `dieCount?`, `dieSides?`, `damageType?` for damage_zone).
   - Add new scratch field on `Combatant` if needed (Session 16 added `_mirrorImageDuplicates?: number`).

3. **Engine integration** in `src/engine/combat.ts`:
   - Import `shouldCast` + `execute` from the new spell module.
   - Add `case 'spellName':` branch in `executePlannedAction` that re-runs `shouldCast` (live target list) and calls `execute`.
   - If the spell modifies a shared computation (e.g. Mirror Image's attack retargeting), update that computation (e.g. `resolveAttack`'s pre-roll section + effectiveAC computation + hit-resolution block).
   - If the spell introduces a new start-of-turn effect (e.g. Cloud of Daggers's damage_zone), add a hook in the `runCombat` loop right after `resetBudget`.

4. **Active-effect integration** in `src/engine/spell_effects.ts` (if the spell uses a new effect type):
   - Add the new effect type to the `_undoEffect` switch (usually a no-op "read at resolution time" case).
   - Add a new query function (e.g. `getActiveDamageZones`) consumed by `combat.ts`.

5. **Cleanup integration** in `src/engine/utils.ts` (if the spell uses a scratch flag with 1-round duration):
   - Import the spell's `cleanup` function.
   - Call it from `resetBudget` with a doc comment explaining the v1 1-round simplification.
   - (Session 16 added NO new cleanup calls — all 5 new spells are either concentration spells or persistent-effect spells that don't need 1-round cleanup.)

6. **Spell DB** in `src/data/spells.ts`:
   - Add an entry to `SPELL_DB` keyed by lowercase spell name (e.g. `'hold person'`, `'mirror image'`).

7. **AI planner** in `src/ai/planner.ts`:
   - Import `shouldCast` from the new spell module.
   - Add a planner branch in `planTurn` (action-time spells).
   - Guard with `if (!plan.action)` so the new spell only fires when no higher-priority spell was chosen.
   - Use `self.actions.some(a => a.name === 'Spell Name')` to gate on the caster having the spell.

8. **Tests** in `src/test/<snake_name>.test.ts`:
   - Mirror the `aid.test.ts` / `branding_smite.test.ts` pattern.
   - Use `makeCombatant` / `makeBF` / `makeState` helpers.
   - 6–9 sections: 1. Metadata, 2. shouldCast gates, 3. shouldCast target priority, 4. execute mechanics, 5. execute logging, 6. cleanup, 7+ Integration pipeline + spell-specific sections.
   - For probabilistic save outcomes (e.g. Hold Person, Crown of Madness), use deterministic save DCs (e.g. WIS 1 + DC 25 = guaranteed fail; WIS 30 + DC 5 = guaranteed success).
   - For resolveAttack integration (e.g. Mirror Image retargeting), SIMULATE the hook logic in a helper function rather than calling resolveAttack directly (mirror `branding_smite.test.ts`'s `simulateBrandingSmiteDamage` pattern).

9. **Cache rebuild**: `npm run spell-cache:build` after implementing — confirm the new spells show `implemented: true` in `spell-cache/INDEX.md`.

### Suggested next batch — level-2 spells (PHB), batch 3

Run `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next 5 unimplemented PHB level-2 spells. After Session 16, the next 5 unimplemented PHB level-2 spells (alphabetically) are:

- **Darkness** (PHB p.230) — Evocation, action, 15-ft radius sphere, blocks vision, concentration 10 min. **WARNING: touches `computeLOS` — coordinate with Core Engine via TEAMGOALS.md before implementing.** Defer if Core Engine is actively working on LOS.
- **Darkvision** (PHB p.230) — Transmutation, action, touch, grants darkvision, 8 hr (no concentration). Mirror Light's touch-effect pattern. Limited combat relevance (v1 has no vision subsystem) — consider skipping.
- **Detect Thoughts** (PHB p.231) — Divination, action, self, concentration 1 min. Out-of-combat utility — skip.
- **Enhance Ability** (PHB p.237) — Transmutation, action, touch, concentration 1 hr. Grants advantage on ability checks for one ability. Could use `rollAbilityCheck` choke point (Session 14). Moderate combat relevance.
- **Enlarge/Reduce** (PHB p.237) — Transmutation, action, 30 ft, CON save, concentration 1 min. Enlarge: +1d8 weapon damage, advantage on STR checks. Reduce: disadvantage on STR checks, half weapon damage. New pattern: size-change + damage modifier.

**Pick recommendation for Session 17:** Enlarge/Reduce + Enhance Ability + Find Steed + Flame Blade + Flaming Sphere (skip Darkness — touches `computeLOS`, defer to a future session or coordinate via TEAMGOALS.md). These 5 exercise diverse patterns (size-change + damage mod, ability-check advantage via `rollAbilityCheck`, summon, weapon-substitute, persistent-damage-zone like Cloud of Daggers but with a save). Verify the alphabetical order and pick with `npm run spell-cache:pick -- --level 2 --source PHB --count 10` before committing to a batch.

### How to add a new TG-NNN entry

If you discover a NEW cross-workstream task during implementation:

1. Read `TEAMGOALS.md` to find the next free `TG-NNN` number.
2. Use the section template at the bottom of `TEAMGOALS.md`.
3. Set Status to `OPEN`, Owners to your workstream + the reviewer workstream.
4. Commit `TEAMGOALS.md` alongside your code changes.

---

## COMPLETED THIS SESSION (Session 16)

### Feature 1: 5 new PHB level-2 spells (batch 2)

Used `npm run spell-cache:pick -- --level 2 --source PHB --count 12` to get the alphabetical list, then picked 5 mechanically diverse spells (per the Session 16 handover's recommendation). All 5 implemented with the pattern documented above:

1. **Hold Person** (`src/spells/hold_person.ts`, PHB p.251) — 2nd-level enchantment, action, 60 ft, concentration 1 min.
   - Effect: WIS save or paralyzed for the duration.
   - Pattern: `condition_apply` effect with `condition: 'paralyzed'`, `sourceIsConcentration: true`. Mirrors Blindness/Deafness but with WIS save + paralyzed + concentration.
   - v1 simplifications: end-of-turn WIS save NOT modelled; humanoid type check skipped (TG-004); upcast NOT modelled; concentration NOT enforced (TG-002).
   - Note: v1's engine does NOT auto-crit paralyzed targets within 5 ft (PHB p.292) — paralyzed only grants advantage on attacks vs the target (via `attackAdvantageState`). This is an engine-level limitation, not a Hold Person bug.
   - Metadata flags: `holdPersonEndOfTurnSaveV1Implemented: false`, `holdPersonUpcastV1Implemented: false`, `holdPersonConcentrationEnforcementV1Implemented: false`, `holdPersonHumanoidTypeCheckV1Implemented: false`.

2. **Crown of Madness** (`src/spells/crown_of_madness.ts`, PHB p.229) — 2nd-level enchantment, action, 120 ft, concentration 1 min.
   - Effect: WIS save or charmed for the duration.
   - Pattern: `condition_apply` effect with `condition: 'charmed'`, `sourceIsConcentration: true`. Mirrors Hold Person but with charmed instead of paralyzed.
   - v1 simplifications: forced-attack rider NOT modelled (engine has no mechanism to override a combatant's AI to attack a specific creature); action maintenance NOT modelled (no multi-turn action commitment subsystem); end-of-turn WIS save NOT modelled; humanoid type check skipped (TG-004); concentration NOT enforced (TG-002).
   - Note: In v1, the charmed condition doesn't prevent the target from attacking the caster's allies (the engine doesn't check `charmed` in `attackAdvantageState` or `planTurn`). The spell's main v1 effect is the charmed condition's interaction with future Calm Emotions / Break Enchantment-style effects.
   - Metadata flags: `crownOfMadnessForcedAttackV1Implemented: false`, `crownOfMadnessActionMaintenanceV1Implemented: false`, `crownOfMadnessEndOfTurnSaveV1Implemented: false`, `crownOfMadnessConcentrationEnforcementV1Implemented: false`, `crownOfMadnessHumanoidTypeCheckV1Implemented: false`.

3. **Calm Emotions** (`src/spells/calm_emotions.ts`, PHB p.221) — 2nd-level enchantment, action, 60 ft, concentration 1 min.
   - Effect: Each humanoid in a 20-ft sphere makes a CHA save. On fail, caster chooses: (a) suppress charmed/frightened, or (b) make target indifferent.
   - v1 implementation: ONLY the "suppress charm/frighten" mode. Targets ALLIES within 60 ft that are charmed or frightened. Allies voluntarily fail the CHA save (PHB p.221: "a creature can choose to fail this saving throw if it wishes") — the save is NOT rolled, conditions are just removed. Enemies are NOT targeted in v1.
   - Pattern: direct `conditions.delete('charmed')` + `conditions.delete('frightened')`. No new effect type needed. Concentration is started but conditions are NOT restored on concentration break (v1 simplification).
   - v1 simplifications: indifference mode NOT modelled; enemy targeting NOT modelled; condition restoration on concentration break NOT modelled; positional AoE NOT modelled (60-ft radius around caster instead of 20-ft sphere centered on a point); humanoid type check skipped (TG-004); concentration NOT enforced (TG-002).
   - Metadata flags: `calmEmotionsIndifferenceModeV1Implemented: false`, `calmEmotionsEnemyTargetingV1Implemented: false`, `calmEmotionsConditionRestorationV1Implemented: false`, `calmEmotionsPositionalAoeV1Implemented: false`, `calmEmotionsConcentrationEnforcementV1Implemented: false`, `calmEmotionsHumanoidTypeCheckV1Implemented: false`.

4. **Cloud of Daggers** (`src/spells/cloud_of_daggers.ts`, PHB p.222) — 2nd-level conjuration, action, 60 ft, concentration 1 min.
   - Effect: 5-ft cube of spinning daggers. A creature takes 4d4 slashing damage when it enters the area for the first time on a turn or starts its turn there.
   - Pattern: NEW `damage_zone` `SpellEffectType` + `payload.dieCount` + `payload.dieSides` + `payload.damageType` + `getActiveDamageZones(c)` query + start-of-turn damage tick in the `runCombat` loop (right after `resetBudget`).
   - v1 implementation: On cast, applies 4d4 slashing to the target immediately (the "enters the area for the first time on a turn" trigger). Applies a `damage_zone` effect on the target. At the start of each of the target's turns, the `runCombat` loop ticks 4d4 slashing (the "starts its turn there" trigger) via `getActiveDamageZones` + `applyDamageWithTempHP`. The damage tick also rolls a concentration check if the actor was concentrating (PARTIAL TG-002 implementation — only for damage_zone ticks, not all damage).
   - v1 simplifications: single-target only (canon 5-ft cube could hit multiple creatures in the same square — rare in 5e); movement tracking NOT modelled (persistent damage applies regardless of whether the target moved out of the zone); upcast NOT modelled; concentration NOT enforced for the on-cast damage (but the start-of-turn tick DOES roll a concentration check — see TG-002 note above).
   - Metadata flags: `cloudOfDaggersMultiTargetV1Implemented: false`, `cloudOfDaggersMovementTrackingV1Implemented: false`, `cloudOfDaggersUpcastV1Implemented: false`, `cloudOfDaggersConcentrationEnforcementV1Implemented: false`.

5. **Mirror Image** (`src/spells/mirror_image.ts`, PHB p.260) — 2nd-level illusion, action, self, NO concentration, 1 min.
   - Effect: 3 illusory duplicates. Each time a creature targets the caster with an attack, roll a d20 to determine whether the attack instead targets a duplicate. Duplicate AC = 10 + caster's DEX mod. On hit, duplicate is destroyed. Spell ends when all 3 duplicates are destroyed.
   - Pattern: NEW `_mirrorImageDuplicates?: number` scratch field on `Combatant` + retargeting hook in `resolveAttack` (before the attack roll) + duplicate-AC computation (replaces `effectiveAC` when retargeted) + duplicate-resolution block (decrements counter on hit, returns early so the real caster takes no damage).
   - v1 implementation: On cast, sets `_mirrorImageDuplicates = 3`. In `resolveAttack`, before the attack roll, if `target._mirrorImageDuplicates > 0`, rolls a d20 against the retargeting threshold (3→6, 2→8, 1→11). If retargeted, the attack roll is compared against the duplicate's AC (10 + target's DEX mod) instead of the caster's effective AC. On hit, one duplicate is destroyed (decrement counter). On miss, the attack simply misses. Either way, the attack doesn't affect the real caster (return early).
   - v1 simplifications: duration NOT tracked (1-min not modelled — lasts until all duplicates destroyed, which is the canon end condition anyway); sight-dependency immunity (blindsight/truesight) NOT modelled (TG-004); NOT a concentration spell (canon: no concentration).
   - Metadata flags: `mirrorImageDurationV1Simplified: true`, `mirrorImageSightDependencyV1Implemented: false`.

### Integration points touched (Session 16)

- `src/types/core.ts`:
  - Added `'damage_zone'` to `SpellEffectType`.
  - Added `dieCount?: number`, `damageType?: DamageType` to `ActiveEffect.payload` (for damage_zone).
  - Added 5 new types to `PlannedAction.type` union: `'calmEmotions'`, `'cloudOfDaggers'`, `'crownOfMadness'`, `'holdPerson'`, `'mirrorImage'`.
  - Added 1 new scratch field on `Combatant`: `_mirrorImageDuplicates?: number` (consumed by `resolveAttack`).
- `src/engine/spell_effects.ts`:
  - Added `'damage_zone'` cases to `applySpellEffect` + `_undoEffect` (no-op "read at resolution time" pattern).
  - Added `getActiveDamageZones(c: Combatant): ActiveEffect[]` query function (returns all active damage_zone effects on a combatant).
- `src/engine/combat.ts`:
  - Imported 5 new spell modules (`calm_emotions`, `cloud_of_daggers`, `crown_of_madness`, `hold_person`, `mirror_image`).
  - Imported `getActiveDamageZones` from `spell_effects`.
  - Added Mirror Image retargeting hook in `resolveAttack` (before the attack roll): rolls d20 against threshold (3→6, 2→8, 1→11), sets `mirrorRetargeted` flag.
  - Modified `effectiveAC` computation in `resolveAttack`: when `mirrorRetargeted`, uses duplicate AC (10 + target's DEX mod) instead of the caster's normal AC.
  - Added Mirror Image duplicate-resolution block in `resolveAttack` (after the hit check): on hit, decrements `_mirrorImageDuplicates` and returns early (real caster takes no damage); on miss, returns early.
  - Added 5 new case branches in `executePlannedAction`: `'calmEmotions'`, `'cloudOfDaggers'`, `'crownOfMadness'`, `'holdPerson'`, `'mirrorImage'`.
  - Added damage_zone start-of-turn tick in the `runCombat` loop (right after `resetBudget`): for each active damage_zone effect on the actor, rolls `dieCount`d`dieSides` damage, applies via `applyDamageWithTempHP`, logs, rolls concentration check if the actor was concentrating, and checks death.
- `src/data/spells.ts`:
  - Added 5 new entries to `SPELL_DB`: `'calm emotions'`, `'cloud of daggers'`, `'crown of madness'`, `'hold person'`, `'mirror image'`. Each has `slotLevel: 2` and appropriate `attackType`/`saveAbility`/`requiresConcentration` fields.
- `src/ai/planner.ts`:
  - Imported `shouldCast` from all 5 new spell modules.
  - Added 5 action-time spell branches in `planTurn` (section 11E-11I, after Blur 11D, before Mage Armor):
    - 11E: Hold Person (single-target save-or-paralyzed, concentration — highest control value).
    - 11F: Crown of Madness (single-target save-or-charmed, concentration).
    - 11G: Cloud of Daggers (single-target damage + persistent zone, concentration).
    - 11H: Calm Emotions (ally debuff removal, concentration — niche, only fires when an ally is charmed/frightened).
    - 11I: Mirror Image (self-buff, NO concentration — can stack with the above).
  - All 5 branches guarded by `if (!plan.action)` so they only fire when no higher-priority spell was chosen.

### Tests written (Session 16)

- `src/test/hold_person.test.ts`: 42/42 (metadata, shouldCast gates + priority, execute save resolution + condition application + slot + concentration + stale-cleanup, logging, cleanup no-op, integration pipeline). Uses deterministic save DCs (WIS 1 + DC 25 = guaranteed fail; WIS 30 + DC 5 = guaranteed success).
- `src/test/crown_of_madness.test.ts`: 40/40 (metadata, shouldCast gates + priority, execute save resolution + condition application + slot + concentration, logging, cleanup no-op, integration pipeline). Uses deterministic save DCs.
- `src/test/calm_emotions.test.ts`: 41/41 (metadata, shouldCast gates + target selection, execute condition removal + slot + concentration, logging, cleanup no-op, integration pipeline).
- `src/test/cloud_of_daggers.test.ts`: 97/97 (metadata, shouldCast gates + priority, execute immediate damage + damage_zone effect + slot + concentration, rollDamage helper, getActiveDamageZones query helper, logging, cleanup no-op, integration pipeline). Includes 50-iteration rollDamage range check.
- `src/test/mirror_image.test.ts`: 55/55 (metadata, shouldCast gates, execute scratch field setup + slot + no-concentration, logging, resolveAttack retargeting hook SIMULATED with 7 deterministic scenarios, cleanup no-op, integration pipeline).
- Total new tests: 275.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 72/557 spells implemented; 5 new level-2 spells show `implemented: true`).
2. Verify Session 16's work landed:
   - `grep -n "getActiveDamageZones" src/engine/spell_effects.ts` (should return ~line 227).
   - `grep -n "case 'calmEmotions'\|case 'cloudOfDaggers'\|case 'crownOfMadness'\|case 'holdPerson'\|case 'mirrorImage'" src/engine/combat.ts` (should return 5 lines).
   - `grep -n "_mirrorImageDuplicates" src/engine/combat.ts` (should return ~4 lines — the retargeting check + the duplicate-resolution block).
   - `grep -n "damage_zone" src/engine/combat.ts` (should return ~2 lines — the comment + the `getActiveDamageZones` call).
3. Run the new test files: `npx ts-node --transpile-only src/test/{hold_person,crown_of_madness,calm_emotions,cloud_of_daggers,mirror_image}.test.ts`. All 5 should print `Results: N passed, 0 failed`.
4. Pick the next batch of level-2 spells: `npm run spell-cache:pick -- --level 2 --source PHB --count 10`. Suggested: Enlarge/Reduce, Enhance Ability, Find Steed, Flame Blade, Flaming Sphere (skip Darkness — touches `computeLOS`, coordinate via TEAMGOALS.md).
5. Implement each spell following the architecture established in Session 15 + extended in Session 16 (documented above).
6. `npx tsc --noEmit` + run the full regression suite (must stay green — 104+ test files, all 0 failures except pre-existing flakies).
7. `npm run spell-cache:build` — confirm the new spells show `implemented: true`.
8. Commit with message format `Cantrip-17: <summary>` (continuing the pivot-workstream prefix from Session 14/15/16).
9. Write `zHANDOVER-SESSION-18.md`.
10. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 16)

- `hold_person.test.ts`: 42/42 (NEW)
- `crown_of_madness.test.ts`: 40/40 (NEW)
- `calm_emotions.test.ts`: 41/41 (NEW)
- `cloud_of_daggers.test.ts`: 97/97 (NEW)
- `mirror_image.test.ts`: 55/55 (NEW)
- Prior level-2 tests still green: `aid.test.ts` 43/43, `barkskin.test.ts` 38/38, `blur.test.ts` 32/32, `blindness_deafness.test.ts` 37/37, `branding_smite.test.ts` 44/44
- Prior level-1 tests still green: `bless.test.ts` 37/37, `entangle.test.ts` 30/30, `faerie_fire.test.ts` 29/29, `magic_missile.test.ts` 25/25, `burning_hands.test.ts` 33/33, `sleep.test.ts` 35/35, `thunderwave.test.ts` 25/25, `arms_of_hadar.test.ts` 39/39, `dissonant_whispers.test.ts` 32/32, `shield_simple.test.ts` 12/12, `shield_of_faith.test.ts` 27/27, `mage_armor.test.ts` 21/21, `guiding_bolt.test.ts` 51/51, `healing_word.test.ts` 41/41, `healing_spells.test.ts` 36/36, `hex.test.ts` 27/27, `warding_bond.test.ts` 41/41
- Engine / AI / resources / scenario / etc. still green: `combat.test.ts` 48/48, `ai.test.ts` 26/26, `resources.test.ts` 72/72, `engine.test.ts` 71/71, `spell_effects.test.ts` 23/23, `mechanics.test.ts` 57/57, `concentration_ai.test.ts` 34/34, `cunning_action.test.ts` 53/53, `death_saves.test.ts` 57/57, `los.test.ts` 54/54, `mount.test.ts` 44/44, `mount_redirect.test.ts` 21/21, `parser.test.ts` 101/101, `pc.test.ts` 270/270, `scenario.test.ts` 94/94, `sneak_attack.test.ts` 23/23, `spell_actions.test.ts` 52/52, `summons.test.ts` 51/51, `day.test.ts` 54/54, `phase4.test.ts` 54/54, `integration.test.ts` 26/26, `character_builder.test.ts` 93/93, `character_improvements.test.ts` 51/51, `character_leveler.test.ts` 207/207, `character_storage.test.ts` 74/74, `adv_system.test.ts` 48/48, `bardic_inspiration.test.ts` 27/27, `html_report.test.ts` 36/36, `server.test.ts` 153/153, `healing.test.ts` 34/34, `rage.test.ts` 44/44, `roll_ability_check.test.ts` 96/96
- All 46 cantrip tests still green (verified via batch runs — see Session 16 work log): `fire_bolt` 43, `acid_splash` 44, `poison_spray` 46, `vicious_mockery` 47, `sacred_flame` 51, `blade_ward` 38, `chill_touch` 38, `shocking_grasp` 26, `thorn_whip` 11, `eldritch_blast` 53, `toll_the_dead` 61, `mind_sliver` 48, `thunderclap` 54, `booming_blade` 218, `frostbite` 57, `sword_burst` 54, `sapping_sting` 50, `lightning_lure` 88, `green_flame_blade` 209, `word_of_radiance` 58, `produce_flame` 52, `infestation` 277, `shillelagh` 60, `create_bonfire` 99, `gust` 74, `primal_savagery` 57, `true_strike` 49, `resistance` 49, `magic_stone` 61, `spare_the_dying` 71, `light` 60, `minor_illusion` 55, `mage_hand` 62, `prestidigitation` 59, `thaumaturgy` 59, `mending` 64, `message` 60, `control_flames` 86, `dancing_lights` 102, `druidcraft` 95, `encode_thoughts` 103, `mold_earth` 106, `shape_water` 118, `friends` 53, `guidance` 52
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **72 implemented** (46 cantrips + 16 level-1 + 10 level-2 + 0 levels 3–9), 472 remaining in-scope.
- Pre-existing flaky tests (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work. (Note: all of these PASSED in Session 16's regression run — the "flaky" label means they SOMETIMES fail, not that they ALWAYS fail.)

---

## NOTES FOR NEXT AGENT

- **The cantrip-z workstream has PIVOTED TWICE.** Session 14: cantrip implementation → forward-compat subsystems (`rollAbilityCheck`). Session 15: forward-compat subsystems → level-2 spell implementation. Session 16: continued level-2 spell implementation (batch 2). The forward-compat work (Options B/C/D/E/F) is tracked in `TEAMGOALS.md` as TG-001..TG-005 — read that file before starting any cross-workstream task.
- **`TEAMGOALS.md` is the single source of truth for cross-workstream coordination.** Per AGENTS.md PRIORITY RULE, the uploaded handover supersedes AGENTS.md. `TEAMGOALS.md` sits below the handover in authority but above `TASK.md`/`ROADMAP.md`. Any agent may append sections (use the template); edit only your own.
- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **The `damage_zone` effect type is NEW in Session 16.** It's the FIRST effect type that deals damage at the start of the affected creature's turn (vs `hex_damage`'s on-hit damage or `condition_apply`'s immediate condition application). The start-of-turn tick is in the `runCombat` loop, right after `resetBudget`. Future persistent-damage spells (e.g. Wall of Fire, Storm Sphere) should follow this pattern.
- **The damage_zone start-of-turn tick includes a PARTIAL TG-002 (concentration) implementation.** When a damage_zone ticks on a concentrating actor, it rolls a concentration save via `rollConcentrationSave`. This is a partial implementation of TG-002 — it only fires for damage_zone ticks, NOT for all damage. The full TG-002 implementation still needs a damage-taken hook in `applyDamage`/`applyDamageWithTempHP`. The Core Engine agent should be aware of this when picking up TG-002.
- **The `_mirrorImageDuplicates` scratch field is the FIRST one that modifies an incoming attack's TARGET.** Unlike `_brandingSmiteActive` (modifies outgoing damage) or `_shillelaghActive` (modifies outgoing attack roll + damage), Mirror Image intercepts an incoming attack and retargets it to a duplicate. The retargeting logic lives in `resolveAttack`'s pre-roll section. Future "incoming-attack-interception" effects (e.g. a hypothetical "Blink" spell that has a chance to teleport the caster away from an attack) should follow this pattern.
- **Mirror Image is the FIRST non-concentration self-buff spell in the level-2 workstream.** Unlike Barkskin / Blur / Branding Smite (all concentration), Mirror Image has NO concentration — it can be cast while concentrating on another spell (e.g. a Wizard concentrating on Blur could also cast Mirror Image). The planner's `shouldCast` does NOT gate on concentration. The spell ends when all duplicates are destroyed (canon end condition), not on concentration break.
- **Hold Person and Crown of Madness both apply conditions via `condition_apply` with `sourceIsConcentration: true`.** This is the same pattern as Entangle (restrained) and Blindness/Deafness (blinded, but `sourceIsConcentration: false`). The difference: Hold Person / Crown of Madness ARE concentration, so the condition is removed via `removeEffectsFromCaster` when concentration breaks. Blindness/Deafness is NOT concentration, so the condition persists for the entire combat.
- **Calm Emotions is the FIRST spell that REMOVES conditions rather than applying them.** It directly calls `target.conditions.delete('charmed')` / `target.conditions.delete('frightened')` rather than using an ActiveEffect. This is because the conditions being removed may have been applied by ANY source (not just this caster's spell), so the effect-removal pattern (`removeEffectsFromCaster`) doesn't apply. v1 does NOT restore the conditions on concentration break (forward-compat TODO).
- **AI planner integration is now included for level-2 spells.** Unlike cantrips (where AI selection was deferred — TG-003), level-2 spells get planner branches in the same session as implementation. Session 16 added 5 new branches (11E-11I) in `planTurn`. Future level-2 spells should follow the same `if (!plan.action)` guard pattern, placed after the Session 16 block (11I Mirror Image) and before Mage Armor.
- **Commit message convention:** `Cantrip-N: <summary>` (Session 14 was `Cantrip-14: ...rollAbilityCheck...`; Session 15 was `Cantrip-15: Pivot to Level-2 spells...`; Session 16 was `Cantrip-16: Implement <spell names>`; Session 17 should be `Cantrip-17: Implement <spell names>`).
- **Pre-existing flaky tests** (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work. (Note: all of these PASSED in Session 16's regression run — the "flaky" label means they SOMETIMES fail, not that they ALWAYS fail.)
- **Architecture summary (level-2 spell pattern — established Session 15, extended Session 16):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (no-op for concentration spells AND for persistent-effect spells that don't use 1-round scratch flags).
  - Type changes: `PlannedAction.type` union + (if new effect type) `SpellEffectType` + `ActiveEffect.payload` + (if scratch flag) `Combatant._<flagName>`.
  - Engine: `combat.ts` case branch + (if shared computation change) `effectiveAC` / `resolveAttack` damage branch / `resolveAttack` pre-roll section + (if new start-of-turn effect) `runCombat` loop hook + (if scratch flag with 1-round duration) `utils.ts` `resetBudget` cleanup call.
  - Active-effect: `spell_effects.ts` (if new effect type) `_undoEffect` no-op case + query function.
  - Spell DB: `data/spells.ts` `SPELL_DB` entry.
  - AI planner: `planner.ts` branch in `planTurn` (action) or `planBonusAction` (bonus action).
  - Tests: `test/<snake_name>.test.ts` mirroring `aid.test.ts` / `branding_smite.test.ts` pattern. Use deterministic save DCs for probabilistic outcomes. SIMULATE resolveAttack hooks rather than calling resolveAttack directly.
- **All `Combatant` scratch fields added across Sessions 7–16:** (Session 14 list, plus Session 15 + 16 additions) `_mindSliverDiePenaltyNextSave?`, `_viciousMockeryDisadvNextAttack?`, `_frostbiteDisadvNextWeaponAttack?`, `_boomingBladePendingDamageDice?`, `_chillTouchNoHealing?` + `_chillTouchUndeadDisadv?`, `_rayOfFrostSpeedReduction?`, `_thornWhipPullPending?`, `_infestationMovePending?`, `_shockingGraspNoReaction?`, `_sappingStingProneApplied?`, `_lightningLurePullPending?`, `_greenFlameBladeSplashPending?`, `_gustPushPending?`, `_shillelaghActive?`, `_trueStrikeAdvNextAttack?`, `_resistanceDieBonusNextSave?`, `_guidanceDieBonusNextAbilityCheck?`, `_friendsAdvNextChaCheck?`, `_lightSourceActive?`, `_isStabilized?`, `_mended?`, **`_aidHPBonus?` (Session 15 — forward-compat only)**, **`_brandingSmiteActive?` (Session 15 — consumed by `resolveAttack`)**, **`_mirrorImageDuplicates?` (Session 16 — NEW, consumed by `resolveAttack` pre-roll retargeting hook)**. Optional with sensible defaults.
- **SpellEffectType registry (updated Session 16):** `advantage_vs`, `ac_bonus`, `ac_floor`, `bless_die`, `condition_apply`, `hex_damage`, **`damage_zone` (Session 16 — NEW)**. The `damage_zone` effect is the first to deal damage at the start of the affected creature's turn (vs `hex_damage`'s on-hit damage).
- **ActiveEffect.payload fields (updated Session 16):** `advType?`, `advScope?`, `acBonus?`, `acFloor?`, `dieSides?`, `condition?`, `hexDie?`, **`dieCount?` (Session 16 — NEW, for damage_zone)**, **`damageType?` (Session 16 — NEW, for damage_zone)**.
- **FIRST level-2 spell milestones (cumulative, for the next agent's reference):**
  - Session 15: FIRST level-2 spell batch (Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite)
  - Session 15: FIRST `ac_floor` `SpellEffectType` (Barkskin — `Math.max` semantics)
  - Session 15: FIRST non-concentration save-or-condition spell (Blindness/Deafness — `sourceIsConcentration: false`)
  - Session 15: FIRST one-shot weapon-attack-rider scratch flag (`_brandingSmiteActive`)
  - Session 15: FIRST cross-workstream coordination file (`TEAMGOALS.md`)
  - Session 15: FIRST workstream-pivot to level-2 spells
  - Session 16: SECOND level-2 spell batch (Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image)
  - Session 16: FIRST `damage_zone` `SpellEffectType` (Cloud of Daggers — start-of-turn damage tick in `runCombat` loop)
  - Session 16: FIRST persistent-damage spell (Cloud of Daggers — 4d4 on cast + 4d4 at start of each of target's turns)
  - Session 16: FIRST incoming-attack-interception scratch flag (`_mirrorImageDuplicates` — retargets incoming attacks to duplicates)
  - Session 16: FIRST non-concentration self-buff spell in level-2 workstream (Mirror Image — can stack with concentration spells)
  - Session 16: FIRST condition-REMOVAL spell (Calm Emotions — directly deletes charmed/frightened from allies, no ActiveEffect)
  - Session 16: FIRST partial TG-002 (concentration) implementation (damage_zone start-of-turn tick rolls concentration save on concentrating actors)
  - Session 16: FIRST save-or-paralyzed spell (Hold Person — paralyzed condition, concentration)
  - Session 16: FIRST save-or-charmed spell with concentration (Crown of Madness — charmed condition, concentration; distinct from Blindness/Deafness which is non-concentration)
- **CANTRIP IMPLEMENTATION WORKSTREAM IS COMPLETE.** All 46 in-scope cantrips implemented (Session 13). Session 14 pivoted to forward-compat subsystems (`rollAbilityCheck` — Option A, DONE). Session 15 pivoted to level-2 spell implementation (5 PHB level-2 spells, DONE) AND created `TEAMGOALS.md`. Session 16 continued level-2 spell implementation (5 more PHB level-2 spells, DONE). Session 17+ should continue level-2 spell implementation.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
