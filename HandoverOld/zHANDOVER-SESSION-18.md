# zHANDOVER-SESSION-18

## REPOSITORY

- Branch: main
- Prior commits (cantrip-z workstream — level-2 spell pivot):
  - `5422d05` — Cantrip-16: Implement Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image (PHB level-2 batch 2).
  - `39594ad` — Cantrip-15: Pivot to Level-2 spells — implement Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite (PHB).
  - `c7e636d` — Cantrip-14: Implement `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot).
  - `d5660dc` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water — FINAL cantrip batch.
  - (see `zHandoversOld/` for Cantrip-1 through Cantrip-12)
- Commits this session:
  - `<new>` — Cantrip-17: Implement Enlarge/Reduce, Enhance Ability, Flame Blade, Flaming Sphere, Heat Metal, Melf's Acid Arrow, Misty Step, Invisibility, Gust of Wind, Levitate, Lesser Restoration, Magic Weapon, Cordon of Arrows, Alter Self, Darkvision (PHB level-2 batch 3 — 15 spells). Also: new `weapon_enchant` + `enlarge_reduce` SpellEffectTypes; `damage_zone` payload extended with `saveDC` + `saveAbility` + `ticksRemaining`; new `getActiveWeaponEnchant` + `getActiveEnlargeReduce` query functions; `damage_zone` sentinel pattern for scratch-field concentration-break cleanup; `resolveAttack` damage-branch hooks for Enlarge/Reduce + Magic Weapon + Flame Blade + Alter Self; `rollAbilityCheck` + `rollSave` extended for Enlarge/Reduce (STR) + Enhance Ability (any); `damage_zone` start-of-turn tick extended with save-for-half + ticksRemaining decrement + auto-removal; AI planner branches 11J–11W (14 action-time) + 2.9 (Misty Step bonus action); spell-cache build.ts regex fix for apostrophe-containing spell names (Melf's Acid Arrow).
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

### Your priorities (cantrip-z workstream — CONTINUING level-2 spells in Session 18)

- **The cantrip implementation workstream is COMPLETE (since Session 13).** All 46 in-scope cantrips are implemented. There are NO more cantrips to implement.
- **Session 14 PIVOTED to forward-compat subsystems** (Option A — `rollAbilityCheck` choke point in `utils.ts`).
- **Session 15 PIVOTED to LEVEL-2 SPELL IMPLEMENTATION** (first batch: Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite). Also created `TEAMGOALS.md`.
- **Session 16 CONTINUED level-2 spell implementation** (second batch: Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image). 5 new PHB level-2 spells.
- **Session 17 (this session) CONTINUED level-2 spell implementation with a DOUBLE-SIZED BATCH of 15 spells** (third batch: Enlarge/Reduce, Enhance Ability, Flame Blade, Flaming Sphere, Heat Metal, Melf's Acid Arrow, Misty Step, Invisibility, Gust of Wind, Levitate, Lesser Restoration, Magic Weapon, Cordon of Arrows, Alter Self, Darkvision). 15 new PHB level-2 spells, total 25 level-2 spells now implemented (10 from Sessions 15–16 + 15 from Session 17).
- **Session 18+ should continue level-2 spell implementation.** Use `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next batch. As of Session 17 end: 87/557 spells implemented (46 cantrips + 15 level-1 + 26 level-2 + 0 levels 3–9).
- **Forward-compat subsystems (the Session 14 pivot direction) are tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem for multi-effect cantrips (was Option B)
  - TG-002: Concentration subsystem (was Option C) — **NOTE: Session 16 added a concentration-check hook in the damage_zone start-of-turn tick (combat.ts runCombat loop). Session 17 EXTENDED this hook to support save-for-half damage zones (Flaming Sphere, Cordon of Arrows) and ticksRemaining-based auto-removal (Melf's Acid Arrow, Cordon of Arrows). This is still a PARTIAL implementation of TG-002 — it only fires when a damage_zone ticks, not on all damage. The full TG-002 implementation still needs a damage-taken hook in `applyDamage`/`applyDamageWithTempHP`.**
  - TG-003: AI planner cantrip selection (was Option D)
  - TG-004: Parser tech debt (was Option E) — **NOTE: Session 16's Mirror Image sight-dependency immunity, Hold Person / Crown of Madness humanoid-type checks, and Session 17's Heat Metal metal-object check are ALL blocked on TG-004.**
  - TG-005: Illusion-disbelief Investigation check (was Option F)
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- Do NOT touch another workstream's handover files.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-17.md`** (the prior session — implemented level-2 batch 3: 15 spells including Enlarge/Reduce, Flaming Sphere, Melf's Acid Arrow, etc.).
3. Read **`TEAMGOALS.md`** — cross-workstream coordination. ANY task that touches multiple workstreams MUST be a `TG-NNN` entry here. Add new entries (do not delete other agents' entries).
4. Read **`SPELL-CACHE.md`** — the cache + picker workflow. Now applies to ALL spell levels (0–9), not just cantrips.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 17 end: 87/557 spells implemented (46 cantrips + 15 level-1 + 26 level-2 + 0 levels 3–9).
7. `grep -n "getActiveWeaponEnchant\|getActiveEnlargeReduce" src/engine/spell_effects.ts` — confirm the Session 17 query functions exist (lines ~266 and ~292).
8. `grep -n "case 'enlargeReduce'\|case 'flamingSphere'\|case 'melfsAcidArrow'\|case 'mistyStep'\|case 'invisibility'\|case 'gustOfWind'\|case 'levitate'\|case 'lesserRestoration'\|case 'magicWeapon'\|case 'cordonOfArrows'\|case 'alterSelf'\|case 'darkvision'\|case 'enhanceAbility'\|case 'flameBlade'\|case 'heatMetal'" src/engine/combat.ts` — confirm the 15 new level-2 case branches exist.
9. `grep -n "weapon_enchant\|enlarge_reduce" src/engine/spell_effects.ts` — confirm the 2 new SpellEffectTypes are handled in `applySpellEffect` + `_undoEffect`.
10. `grep -n "ticksRemaining\|saveDC\|saveAbility" src/engine/combat.ts` — confirm the damage_zone start-of-turn tick supports the Session 17 payload extensions (save-for-half + ticksRemaining decrement).

---

## GOALS THIS SESSION — CONTINUE LEVEL-2 SPELL IMPLEMENTATION

The cantrip-z workstream is CONTINUING PHB level-2 spells. The third batch (15 spells — a double-sized batch per user instruction) landed in Session 17. The next batch should follow the same pattern (5 spells per session, the standard batch size).

### Architecture established in Session 15 (for level-2 spells) — EXTENDED in Sessions 16 + 17

The level-2 spell pattern mirrors the existing level-1 spell pattern (Bless / Entangle / Faerie Fire / etc.):

1. **Spell module** in `src/spells/<snake_name>.ts`:
   - `export const metadata = { name, level: 2, school, rangeFt, concentration, castingTime, ...metadata flags } as const;`
   - `export function shouldCast(caster, bf) → Combatant | Combatant[] | { target, mode } | { target, ability } | { destination } | boolean | null` — planner hook. The return type varies by spell (single-target, multi-target, mode-selection, ability-selection, destination-selection, self-buff).
   - `export function execute(caster, target/targets/state/destination/mode/ability) → void` — applies the effect. Signature varies by spell.
   - `export function cleanup(c) → void` — for `resetBudget` integration (no-op for concentration spells; safety-net for scratch-flag spells).

2. **Type changes** in `src/types/core.ts`:
   - Add new `'spellName'` to the `PlannedAction.type` union.
   - Add new `SpellEffectType` if needed (Session 17 added `'weapon_enchant'` for Magic Weapon and `'enlarge_reduce'` for Enlarge/Reduce).
   - Add new `payload` field if needed (Session 17 added `saveDC?`, `saveAbility?`, `ticksRemaining?` to damage_zone payload; `attackBonus?`, `damageBonus?` to weapon_enchant payload; `enlargeReduceMode?` to enlarge_reduce payload).
   - Add new scratch field on `Combatant` if needed (Session 17 added `_flameBladeActive?`, `_alterSelfActive?`, `_enhanceAbilityActive?`, `_darkvisionActive?`. Reserved but unused: `_enlargeReduceActive?`, `_magicWeaponBonus?` — these are modeled via ActiveEffects instead.).

3. **Engine integration** in `src/engine/combat.ts`:
   - Import `shouldCast` + `execute` from the new spell module.
   - Add `case 'spellName':` branch in `executePlannedAction` that re-runs `shouldCast` (live target list) and calls `execute`.
   - If the spell modifies a shared computation (e.g. Enlarge/Reduce's weapon-damage mod, Magic Weapon's attack/damage bonus, Flame Blade's +3d6 fire rider, Alter Self's unarmed-strike substitution), update that computation (e.g. `resolveAttack`'s attack-roll section + damage branch).
   - If the spell introduces a new start-of-turn effect (e.g. Flaming Sphere's save-for-half damage_zone, Cordon of Arrows's ticksRemaining-limited damage_zone), the existing damage_zone hook in `runCombat` (right after `resetBudget`) handles it — no new hook needed.

4. **Active-effect integration** in `src/engine/spell_effects.ts` (if the spell uses a new effect type):
   - Add the new effect type to the `applySpellEffect` switch (usually a no-op "read at resolution time" case).
   - Add the new effect type to the `_undoEffect` switch (usually a no-op; for scratch-field buffs using a damage_zone sentinel, add spellName-specific cleanup).
   - Add a new query function (e.g. `getActiveWeaponEnchant`, `getActiveEnlargeReduce`) consumed by `combat.ts` / `utils.ts`.
   - **Session 17 sentinel pattern**: concentration-bound scratch-field buffs (Flame Blade, Alter Self, Enhance Ability) attach a `damage_zone` effect with `dieCount: 0` as a lifecycle anchor. The `_undoEffect` function's `damage_zone` case checks for `dieCount === 0` and clears the matching scratch field based on `spellName`. This avoids the need for a per-spell concentration-break hook.

5. **Cleanup integration** in `src/engine/utils.ts` (if the spell uses a scratch flag with 1-round duration):
   - Import the spell's `cleanup` function.
   - Call it from `resetBudget` with a doc comment explaining the v1 1-round simplification.
   - (Session 17 added NO new cleanup calls — all 15 new spells are either concentration spells or persistent-effect spells that don't need 1-round cleanup. Flame Blade / Alter Self / Enhance Ability use the damage_zone sentinel pattern instead of cleanup.)

6. **Ability-check / save integration** in `src/engine/utils.ts` (if the spell modifies ability checks or saves):
   - Session 17 extended `rollAbilityCheck` to check `_enhanceAbilityActive` (Enhance Ability — advantage on the matching ability's checks) and `getActiveEnlargeReduce` (Enlarge/Reduce — STR advantage/disadvantage).
   - Session 17 extended `rollSave` to check `getActiveEnlargeReduce` (Enlarge/Reduce — STR save advantage/disadvantage).

7. **Spell DB** in `src/data/spells.ts`:
   - Add an entry to `SPELL_DB` keyed by lowercase spell name (e.g. `'enlarge/reduce'`, `"melf's acid arrow"`).

8. **AI planner** in `src/ai/planner.ts`:
   - Import `shouldCast` from the new spell module.
   - Add a planner branch in `planTurn` (action-time spells) or `planBonusAction` (bonus action spells).
   - Guard with `if (!plan.action)` so the new spell only fires when no higher-priority spell was chosen.
   - Use `self.actions.some(a => a.name === 'Spell Name')` to gate on the caster having the spell.
   - Session 17 added 14 action-time branches (11J–11W) + 1 bonus-action branch (2.9 Misty Step).

9. **Tests** in `src/test/<snake_name>.test.ts`:
   - Mirror the `aid.test.ts` / `branding_smite.test.ts` / `cloud_of_daggers.test.ts` pattern.
   - Use `makeCombatant` / `makeBF` / `makeState` helpers.
   - 6–8 sections: 1. Metadata, 2. shouldCast gates, 3. shouldCast target priority, 4. execute mechanics, 5. execute logging, 6. cleanup, 7+ Integration + spell-specific sections.
   - For probabilistic save outcomes (e.g. Enlarge/Reduce, Flaming Sphere, Gust of Wind, Levitate), use deterministic save DCs (e.g. CON 1 + DC 25 = guaranteed fail; CON 30 + DC 5 = guaranteed success).
   - For resolveAttack integration (e.g. Enlarge/Reduce's damage mod, Magic Weapon's attack/damage bonus, Flame Blade's +3d6 fire, Alter Self's unarmed-strike substitution), SIMULATE the hook logic in a helper function rather than calling resolveAttack directly (mirror `branding_smite.test.ts`'s `simulateBrandingSmiteDamage` pattern). For the damage_zone save-for-half + ticksRemaining, verify the effect payload is correct (the start-of-turn tick is integration-tested via the combat loop, not unit-tested).
   - **IMPORTANT**: use `conditions: new Set() as Set<Condition>` (NOT `new Set<string>()`) in the makeCombatant helper — `tsc --noEmit` will fail otherwise.

10. **Cache rebuild**: `npm run spell-cache:build` after implementing — confirm the new spells show `implemented: true` in `spell-cache/INDEX.md`.
    - **Session 17 fix**: the build script's regex for extracting `metadata.name` was updated to handle apostrophe-containing names (e.g. "Melf's Acid Arrow"). The old regex `[^'"]+` stopped at the first apostrophe; the new regex `("([^"]*)"|'([^']*)')` correctly handles apostrophes inside double-quoted strings. If a future spell has an apostrophe in its name, the cache will now detect it correctly.

### Suggested next batch — level-2 spells (PHB), batch 4

Run `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next 5 unimplemented PHB level-2 spells. After Session 17, the next 5 unimplemented PHB level-2 spells (alphabetically) are:

- **Pyrotechnics** (PHB p.269) — Transmutation, action, 60 ft, choice of effect (fireworks or smoke), instantaneous. v1 would need to model the two modes.
- **Ray of Enfeeblement** (PHB p.270) — Necromancy, action, 60 ft, CON save or deal half damage with weapon attacks, concentration 1 min. Could use a new `damage_multiplier` effect (similar to Enlarge/Reduce's 'reduce' mode but on a target, not the attacker).
- **Rope Trick** (PHB p.272) — Transmutation, action, touch, creates an extradimensional space, 1 hr. Out-of-combat utility — skip.
- **Scorching Ray** (PHB p.273) — Evocation, action, 120 ft, 3 ranged spell attacks 2d6 fire each (upcast +1 ray/slot). NEW pattern: multi-attack spell (like Eldritch Blast but level-2).
- **See Invisibility** (PHB p.274) — Divination, action, self, see invisible creatures, 1 hr. Could use a forward-compat flag like Darkvision's `_darkvisionActive`.

**Pick recommendation for Session 18:** Scorching Ray + Ray of Enfeeblement + Shatter + Silence + Spider Climb (skip Rope Trick — out-of-combat; skip Pyrotechnics — two-mode complexity). These 5 exercise diverse patterns (multi-attack spell, damage-debuff, AoE damage, AoE silence, movement-utility). Verify with `npm run spell-cache:pick -- --level 2 --source PHB --count 10` before committing to a batch.

**IMPORTANT — Darkness is STILL deferred.** Session 15's handover warned that Darkness touches `computeLOS` — coordinate with Core Engine via TEAMGOALS.md before implementing. Session 17 did NOT implement Darkness.

### How to add a new TG-NNN entry

If you discover a NEW cross-workstream task during implementation:

1. Read `TEAMGOALS.md` to find the next free `TG-NNN` number.
2. Use the section template at the bottom of `TEAMGOALS.md`.
3. Set Status to `OPEN`, Owners to your workstream + the reviewer workstream.
4. Commit `TEAMGOALS.md` alongside your code changes.

---

## COMPLETED THIS SESSION (Session 17)

### Feature 1: 15 new PHB level-2 spells (batch 3 — DOUBLE-SIZED per user instruction)

User explicitly requested "15 more" spells for this session (vs. the standard 5-spell batch). Used `npm run spell-cache:pick -- --level 2 --source PHB --count 30` to get the alphabetical list, then picked 15 mechanically diverse spells (skipping Darkness — touches `computeLOS`; skipping pure out-of-combat utility — Augury, Beast Sense, Animal Messenger, Arcane Lock, Find Traps, Gentle Repose, Locate Animals/Plants, Locate Object, Magic Mouth, Knock, Continual Flame; skipping Find Steed — complex summon subsystem). All 15 implemented with the pattern documented above:

1. **Enlarge/Reduce** (`src/spells/enlarge_reduce.ts`, PHB p.237) — 2nd-level transmutation, action, 30 ft, concentration 1 min.
   - Effect: CON save or buff/debuff. 'enlarge' (ally): +1d8 weapon damage, advantage on STR checks/saves. 'reduce' (enemy): half weapon damage, disadvantage on STR checks/saves.
   - Pattern: NEW `enlarge_reduce` SpellEffectType with `payload.enlargeReduceMode`. Queried by `getActiveEnlargeReduce(c)` in spell_effects.ts. resolveAttack's damage branch checks the ATTACKER's effect; rollAbilityCheck + rollSave check the creature's OWN effect for STR.
   - v1 simplifications: size category NOT modelled; object targeting NOT modelled; concentration NOT enforced (TG-002). v1 PRIORITIZES the 'reduce' (enemy debuff) use case — only falls back to 'enlarge' (ally buff) if no enemy is in range.
   - Metadata flags: `enlargeReduceSizeCategoryV1Implemented: false`, `enlargeReduceObjectTargetingV1Implemented: false`, `enlargeReduceConcentrationEnforcementV1Implemented: false`.

2. **Enhance Ability** (`src/spells/enhance_ability.ts`, PHB p.237) — 2nd-level transmutation, action, touch, concentration 1 hr.
   - Effect: Grants advantage on one ability's checks (v1 picks the target's highest ability).
   - Pattern: `_enhanceAbilityActive` scratch field on target + damage_zone sentinel (dieCount=0) for concentration-break cleanup. rollAbilityCheck checks the scratch field for the matching ability.
   - v1 simplifications: Bear's Endurance 2d6 temp HP NOT modelled; Cat's Grace fall-damage immunity NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `enhanceAbilityTempHPV1Implemented: false`, `enhanceAbilityFallDamageImmunityV1Implemented: false`, `enhanceAbilityConcentrationEnforcementV1Implemented: false`.

3. **Flame Blade** (`src/spells/flame_blade.ts`, PHB p.242) — 2nd-level evocation, action, self, concentration 10 min.
   - Effect: v1 — +3d6 fire rider on melee weapon attacks (canon: creates a new melee weapon; v1 simplification mirrors Shillelagh's +1d8 radiant pattern).
   - Pattern: `_flameBladeActive` scratch field on caster + damage_zone sentinel. resolveAttack's damage branch checks the flag for melee weapon attacks.
   - v1 simplifications: modeled as a rider (canon: new melee weapon); bonus-action re-evoke NOT modelled; upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `flameBladeAsWeaponRiderV1Simplified: true`, `flameBladeReEvokeV1Implemented: false`, `flameBladeUpcastV1Implemented: false`, `flameBladeConcentrationEnforcementV1Implemented: false`.

4. **Flaming Sphere** (`src/spells/flaming_sphere.ts`, PHB p.242) — 2nd-level conjuration, action, 60 ft, concentration 1 min.
   - Effect: DEX save 2d6 fire (half on save) on cast + persistent damage_zone (2d6 fire/turn, DEX save for half).
   - Pattern: `damage_zone` effect with NEW `saveDC` + `saveAbility` payload fields. The start-of-turn tick (combat.ts runCombat loop) rolls the save and halves damage on success.
   - v1 simplifications: single-target only (canon: 5-ft sphere); sphere movement NOT modelled; upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `flamingSphereMovementV1Implemented: false`, `flamingSphereMultiTargetV1Implemented: false`, `flamingSphereUpcastV1Implemented: false`, `flamingSphereConcentrationEnforcementV1Implemented: false`.

5. **Heat Metal** (`src/spells/heat_metal.ts`, PHB p.250) — 2nd-level transmutation, action, 60 ft, concentration 1 min.
   - Effect: 2d8 fire on cast (NO save — automatic) + persistent damage_zone (2d8 fire/turn, NO save). CON save rolled for logging only (drop-object mechanic NOT modelled).
   - Pattern: `damage_zone` effect WITHOUT saveDC (damage is automatic). The start-of-turn tick applies 2d8 fire each turn.
   - v1 simplifications: bonus-action repeat NOT modelled (canon: caster uses bonus action on subsequent turns); drop-object mechanic NOT modelled; holding-disadvantage NOT modelled; metal-object check skipped (TG-004); upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `heatMetalBonusActionRepeatV1Implemented: false`, `heatMetalDropObjectV1Implemented: false`, `heatMetalHoldingDisadvantageV1Implemented: false`, `heatMetalMetalObjectCheckV1Implemented: false`, `heatMetalUpcastV1Implemented: false`, `heatMetalConcentrationEnforcementV1Implemented: false`.

6. **Melf's Acid Arrow** (`src/spells/melf_s_acid_arrow.ts`, PHB p.259) — 2nd-level evocation, action, 90 ft, NO concentration.
   - Effect: Ranged spell attack, 4d4 acid on hit + 2d4 acid at the start of the target's next turn (delayed damage).
   - Pattern: 4d4 acid applied immediately on hit. Delayed 2d4 acid modeled as a `damage_zone` effect with NEW `ticksRemaining: 1` payload field (one tick at start of target's next turn, then auto-removed). NO save on the delayed damage (acid is automatic).
   - v1 simplifications: delayed damage ticks at start-of-next-turn (canon: end-of-next-turn); upcast NOT modelled; NOT concentration; crit does NOT double the spell's fixed damage dice (PHB p.196 crit only doubles "damage dice in the attack" — v1 simplification).
   - Metadata flags: `melfsAcidArrowEndOfTurnV1Simplified: true`, `melfsAcidArrowUpcastV1Implemented: false`.

7. **Misty Step** (`src/spells/misty_step.ts`, PHB p.260) — 2nd-level conjuration, BONUS ACTION, self, NO concentration.
   - Effect: Teleport up to 30 ft to an unoccupied space.
   - Pattern: shouldCast returns `{ destination: Vec3 }`. v1 picks the destination: toward the nearest enemy (to close distance) or away (if below 25% HP — escape). execute sets `caster.pos = destination`.
   - v1 simplifications: destination LOS NOT verified; unoccupied-space check skipped; NOT concentration.
   - Metadata flags: `mistyStepDestinationLOSV1Implemented: false`, `mistyStepUnoccupiedSpaceV1Implemented: false`.

8. **Invisibility** (`src/spells/invisibility.ts`, PHB p.254) — 2nd-level illusion, action, touch, concentration 1 hr.
   - Effect: Grants the `invisible` condition. The condition is already wired into `attackAdvantageState` (invisible attacker has advantage, attacks vs invisible target have disadvantage).
   - Pattern: `condition_apply:invisible` effect with `sourceIsConcentration: true`.
   - v1 simplifications: ends-on-attack NOT modelled (canon: spell ends when the target attacks or casts); upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `invisibilityEndsOnAttackV1Implemented: false`, `invisibilityUpcastV1Implemented: false`, `invisibilityConcentrationEnforcementV1Implemented: false`.

9. **Gust of Wind** (`src/spells/gust_of_wind.ts`, PHB p.248) — 2nd-level evocation, action, line 60 ft, concentration 1 min.
   - Effect: STR save or pushed 15 ft. No damage.
   - Pattern: STR save; on fail, set `target.pos` 15 ft (3 grid squares) directly away from the caster, clamped to [0,29].
   - v1 simplifications: single-target only (canon: line AoE); one-shot push (canon: persistent start-of-turn push); difficult-terrain rider NOT modelled; concentration is cosmetic in v1 (no persistent effect); concentration NOT enforced (TG-002).
   - Metadata flags: `gustOfWindLineAoeV1Implemented: false`, `gustOfWindStartOfTurnPushV1Implemented: false`, `gustOfWindDifficultTerrainV1Implemented: false`, `gustOfWindConcentrationEnforcementV1Implemented: false`.

10. **Levitate** (`src/spells/levitate.ts`, PHB p.255) — 2nd-level transmutation, action, 60 ft, concentration 10 min.
    - Effect: CON save or levitate (can move only vertically). v1 models as the `restrained` condition (closest PHB condition — speed 0, attacks vs target have advantage, target has disadv on attacks/Dex saves).
    - Pattern: `condition_apply:restrained` effect with `sourceIsConcentration: true`.
    - v1 simplifications: modeled as restrained (canon: no standard condition — slightly too punishing); end-of-turn CON save NOT modelled; vertical movement NOT modelled; object targeting NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `levitateAsRestrainedV1Simplified: true`, `levitateEndOfTurnSaveV1Implemented: false`, `levitateVerticalMovementV1Implemented: false`, `levitateObjectTargetingV1Implemented: false`, `levitateConcentrationEnforcementV1Implemented: false`.

11. **Lesser Restoration** (`src/spells/lesser_restoration.ts`, PHB p.255) — 2nd-level abjuration, action, touch, NO concentration.
    - Effect: Ends one disease or one condition (blinded, deafened, paralyzed, or poisoned). v1 removes ALL listed conditions (more powerful than canon).
    - Pattern: direct `target.conditions.delete(cond)` for each removable condition (mirrors Calm Emotions's direct-removal approach).
    - v1 simplifications: removes ALL listed conditions (canon: one); diseases NOT modelled; NOT concentration.
    - Metadata flags: `lesserRestorationSingleConditionV1Simplified: true`, `lesserRestorationDiseaseV1Implemented: false`.

12. **Magic Weapon** (`src/spells/magic_weapon.ts`, PHB p.257) — 2nd-level transmutation, action, touch, concentration 1 hr.
    - Effect: Weapon +1 to attack rolls AND damage rolls.
    - Pattern: NEW `weapon_enchant` SpellEffectType with `payload.attackBonus` + `payload.damageBonus`. Queried by `getActiveWeaponEnchant(c)` in spell_effects.ts. resolveAttack's attack-roll branch adds the attackBonus to the total; the damage branch adds the damageBonus. Applies to melee/ranged weapon attacks (NOT spell).
    - v1 simplifications: applies to ALL of the wielder's weapon attacks (canon: a specific weapon); nonmagical-weapon check skipped; upcast (+2/+3) NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `magicWeaponPerWeaponV1Implemented: false`, `magicWeaponNonmagicalCheckV1Implemented: false`, `magicWeaponUpcastV1Implemented: false`, `magicWeaponConcentrationEnforcementV1Implemented: false`.

13. **Cordon of Arrows** (`src/spells/cordon_of_arrows.ts`, PHB p.228) — 2nd-level transmutation, action, 5 ft, NO concentration (1 min).
    - Effect: 4 pieces of ammunition, each deals 1d6 piercing. v1: DEX save for half (canon: ranged spell attack). 4-piece damage_zone (ticksRemaining: 4).
    - Pattern: `damage_zone` effect with `saveDC` + `saveAbility: 'dex'` + `ticksRemaining: 4`. NO on-cast damage. The start-of-turn tick rolls 1d6 piercing with DEX save for half, decrements ticksRemaining, and auto-removes the effect when ticksRemaining reaches 0.
    - v1 simplifications: DEX save (canon: ranged spell attack); auto-tick (canon: bonus action to fire a piece); single-target (canon: retarget each piece); upcast NOT modelled; NOT concentration.
    - Metadata flags: `cordonOfArrowsSaveVsAttackV1Simplified: true`, `cordonOfArrowsBonusActionTriggerV1Implemented: false`, `cordonOfArrowsRetargetingV1Implemented: false`, `cordonOfArrowsUpcastV1Implemented: false`.

14. **Alter Self** (`src/spells/alter_self.ts`, PHB p.211) — 2nd-level transmutation, action, self, concentration 10 min.
    - Effect: v1 implements ONLY the "Natural Weapons" option — unarmed strikes deal 1d6 + STR mod slashing instead of 1 + STR mod.
    - Pattern: `_alterSelfActive = 'naturalWeapons'` scratch field on caster + damage_zone sentinel. resolveAttack's damage branch detects unarmed strikes (action.damage = {count:1, sides:1, bonus:0}) and regenerates the damage as 1d6 + STR mod.
    - v1 simplifications: only Natural Weapons option (Aquatic Adaptation + Change Appearance NOT modelled); always slashing (canon: chosen when cast); magical-unarmed-strike rider moot in v1; concentration NOT enforced (TG-002).
    - Metadata flags: `alterSelfAquaticAdaptationV1Implemented: false`, `alterSelfChangeAppearanceV1Implemented: false`, `alterSelfConcentrationEnforcementV1Implemented: false`.

15. **Darkvision** (`src/spells/darkvision.ts`, PHB p.230) — 2nd-level transmutation, action, touch, NO concentration (8 hr).
    - Effect: Grants darkvision 60 ft. v1 has NO vision subsystem — sets a forward-compat flag `_darkvisionActive` on the target (like Light's `_lightSourceActive`).
    - Pattern: direct `target._darkvisionActive = true` (no ActiveEffect — forward-compat flag only).
    - v1 simplifications: vision subsystem NOT implemented (flag is forward-compat only); 8-hr duration not tracked (persists for combat, like Aid); upcast NOT modelled; NOT concentration.
    - Metadata flags: `darkvisionVisionIntegrationV1Implemented: false`, `darkvisionDurationV1Simplified: true`, `darkvisionUpcastV1Implemented: false`.

### Integration points touched (Session 17)

- `src/types/core.ts`:
  - Added 2 new `SpellEffectType`s: `'weapon_enchant'`, `'enlarge_reduce'`.
  - Added 3 new `damage_zone` payload fields: `saveDC?`, `saveAbility?`, `ticksRemaining?`.
  - Added 2 new `weapon_enchant` payload fields: `attackBonus?`, `damageBonus?`.
  - Added 1 new `enlarge_reduce` payload field: `enlargeReduceMode?`.
  - Added 15 new types to `PlannedAction.type` union: `'enlargeReduce'`, `'enhanceAbility'`, `'flameBlade'`, `'flamingSphere'`, `'heatMetal'`, `'melfsAcidArrow'`, `'mistyStep'`, `'invisibility'`, `'gustOfWind'`, `'levitate'`, `'lesserRestoration'`, `'magicWeapon'`, `'cordonOfArrows'`, `'alterSelf'`, `'darkvision'`.
  - Added 6 new scratch fields on `Combatant`: `_enlargeReduceActive?` (reserved — modeled via ActiveEffect), `_enhanceAbilityActive?`, `_flameBladeActive?`, `_magicWeaponBonus?` (reserved — modeled via ActiveEffect), `_alterSelfActive?`, `_darkvisionActive?`.
- `src/engine/spell_effects.ts`:
  - Added `'weapon_enchant'` + `'enlarge_reduce'` cases to `applySpellEffect` (no-op "read at resolution time").
  - Added `'weapon_enchant'` + `'enlarge_reduce'` cases to `_undoEffect` (no-op).
  - Extended `_undoEffect`'s `'damage_zone'` case to clear scratch fields for spells using the sentinel pattern (Flame Blade, Alter Self, Enhance Ability) when `dieCount === 0`.
  - Added `getActiveWeaponEnchant(c): { attackBonus, damageBonus }` query function.
  - Added `getActiveEnlargeReduce(c): 'enlarge' | 'reduce' | null` query function.
- `src/engine/combat.ts`:
  - Imported 15 new spell modules.
  - Imported `getActiveWeaponEnchant` + `getActiveEnlargeReduce` + `removeEffectById` from spell_effects.
  - Added Magic Weapon attack-roll bonus hook in `resolveAttack` (after Bless die, before effectiveAC).
  - Added 4 new damage-branch hooks in `resolveAttack`: Enlarge/Reduce (+1d8 enlarge / half reduce), Magic Weapon (+N damage), Flame Blade (+3d6 fire on melee), Alter Self (regenerate unarmed-strike damage as 1d6 + STR).
  - Added 15 new case branches in `executePlannedAction`: `'enlargeReduce'`, `'enhanceAbility'`, `'flameBlade'`, `'flamingSphere'`, `'heatMetal'`, `'melfsAcidArrow'`, `'mistyStep'`, `'invisibility'`, `'gustOfWind'`, `'levitate'`, `'lesserRestoration'`, `'magicWeapon'`, `'cordonOfArrows'`, `'alterSelf'`, `'darkvision'`.
  - Extended the damage_zone start-of-turn tick in the `runCombat` loop: now rolls a save (if `saveDC` + `saveAbility` present) for half damage; decrements `ticksRemaining` and auto-removes the effect when it reaches 0; skips sentinel effects (dieCount=0).
- `src/engine/utils.ts`:
  - Imported `getActiveEnlargeReduce` from spell_effects.
  - Extended `rollSave` to check `getActiveEnlargeReduce` for STR save advantage (enlarge) / disadvantage (reduce).
  - Extended `rollAbilityCheck` to check `getActiveEnlargeReduce` for STR check advantage/disadvantage AND `_enhanceAbilityActive` for advantage on the matching ability's checks.
- `src/data/spells.ts`:
  - Added 15 new entries to `SPELL_DB`: `'enlarge/reduce'`, `'enhance ability'`, `'flame blade'`, `'flaming sphere'`, `'heat metal'`, `"melf's acid arrow"`, `'misty step'`, `'invisibility'`, `'gust of wind'`, `'levitate'`, `'lesser restoration'`, `'magic weapon'`, `'cordon of arrows'`, `'alter self'`, `'darkvision'`. Each has `slotLevel: 2` and appropriate `attackType`/`saveAbility`/`requiresConcentration`/`bonusAction` fields.
- `src/ai/planner.ts`:
  - Imported `shouldCast` from all 15 new spell modules.
  - Added 14 action-time spell branches in `planTurn` (sections 11J–11W, after Mirror Image 11I, before Mage Armor):
    - 11J: Melf's Acid Arrow (ranged spell attack, highest damage, NO concentration — highest priority of the 15).
    - 11K: Heat Metal (CON save, persistent 2d8 fire/turn, concentration).
    - 11L: Flaming Sphere (DEX save, persistent 2d6 fire/turn, concentration).
    - 11M: Cordon of Arrows (DEX save, persistent 1d6 piercing/turn × 4, NO concentration).
    - 11N: Enlarge/Reduce (CON save, buff/debuff, concentration).
    - 11O: Gust of Wind (STR save, push 15 ft, concentration).
    - 11P: Levitate (CON save or restrained, concentration).
    - 11Q: Invisibility (touch, invisible condition, concentration).
    - 11R: Magic Weapon (touch, weapon +1, concentration).
    - 11S: Enhance Ability (touch, ability-check advantage, concentration).
    - 11T: Flame Blade (self, +3d6 fire rider, concentration).
    - 11U: Alter Self (self, natural weapons, concentration).
    - 11V: Lesser Restoration (touch, condition removal, NO concentration).
    - 11W: Darkvision (touch, forward-compat, NO concentration — lowest priority).
  - Added 1 bonus-action spell branch in `planBonusAction` (section 2.9, after Branding Smite 2.8, before Bardic Inspiration 3):
    - 2.9: Misty Step (bonus action, self teleport 30 ft, NO concentration).
  - All 14 action-time branches guarded by `if (!plan.action)` so they only fire when no higher-priority spell was chosen.
- `scripts/spell-cache/build.ts`:
  - Fixed the `moduleNameFromFile` regex to handle apostrophe-containing spell names (e.g. "Melf's Acid Arrow"). The old regex `[^'"]+` stopped at the first apostrophe; the new regex `("([^"]*)"|'([^']*)')` correctly handles apostrophes inside double-quoted strings and double quotes inside single-quoted strings.

### Tests written (Session 17)

- `src/test/enlarge_reduce.test.ts`: 60/60 (metadata, shouldCast gates + target priority + mode selection, execute save resolution + effect application, logging, cleanup no-op, integration).
- `src/test/enhance_ability.test.ts`: 46/46 (metadata, shouldCast gates + target priority + highest-ability selection, execute scratch field + sentinel, logging, cleanup no-op, integration).
- `src/test/flame_blade.test.ts`: 43/43 (metadata, shouldCast gates incl. melee-attack requirement, execute scratch field + sentinel, logging, cleanup no-op, integration).
- `src/test/flaming_sphere.test.ts`: 104/104 (metadata, shouldCast gates + priority, execute save resolution full/half, damage_zone with saveDC + saveAbility, rollDamage range check, logging, cleanup no-op, integration). 50-iteration rollDamage range check.
- `src/test/heat_metal.test.ts`: 108/108 (metadata, shouldCast gates + priority, execute automatic damage on both save outcomes, damage_zone WITHOUT saveDC, rollDamage range check, logging, cleanup no-op, integration). 50-iteration rollDamage range check.
- `src/test/melf_s_acid_arrow.test.ts`: 159/159 (metadata, shouldCast gates + priority, execute on hit, execute on miss, damage_zone with ticksRemaining: 1, rollImmediateDamage + rollDelayedDamage range checks, logging, cleanup no-op, integration).
- `src/test/misty_step.test.ts`: 54/54 (metadata, shouldCast gates, shouldCast destination logic toward/away/clamped, execute teleport, logging, cleanup no-op, integration).
- `src/test/invisibility.test.ts`: 44/44 (metadata, shouldCast gates + priority, execute invisible condition applied, logging, cleanup no-op, integration).
- `src/test/gust_of_wind.test.ts`: 52/52 (metadata, shouldCast gates + priority, execute save resolution + push direction + clamping, logging, cleanup no-op, integration).
- `src/test/levitate.test.ts`: 57/57 (metadata incl. levitateAsRestrainedV1Simplified, shouldCast gates + priority, execute save resolution + restrained condition, logging, cleanup no-op, integration).
- `src/test/lesser_restoration.test.ts`: 47/47 (metadata, shouldCast gates + priority, execute all-conditions-removed, logging, cleanup no-op, integration).
- `src/test/magic_weapon.test.ts`: 53/53 (metadata, shouldCast gates + priority, execute weapon_enchant effect, getActiveWeaponEnchant query verification, logging, cleanup no-op, integration).
- `src/test/cordon_of_arrows.test.ts`: 103/103 (metadata, shouldCast gates + priority, execute damage_zone with ticksRemaining: 4 + NO on-cast damage, rollDamage range check, logging, cleanup no-op, integration). 50-iteration rollDamage range check.
- `src/test/alter_self.test.ts`: 43/43 (metadata, shouldCast gates incl. no-weapon-attacks requirement, execute scratch field + sentinel, logging, cleanup no-op, integration).
- `src/test/darkvision.test.ts`: 41/41 (metadata incl. v1 flags, shouldCast gates + priority, execute scratch field + NO concentration, logging, cleanup no-op, integration).
- Total new tests: 1014 assertions across 15 files.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 87/557 spells implemented; 15 new level-2 spells show `implemented: true`).
2. Verify Session 17's work landed:
   - `grep -n "getActiveWeaponEnchant\|getActiveEnlargeReduce" src/engine/spell_effects.ts` (should return ~4 lines).
   - `grep -n "case 'enlargeReduce'\|case 'flamingSphere'\|case 'melfsAcidArrow'\|case 'mistyStep'\|case 'invisibility'\|case 'gustOfWind'\|case 'levitate'\|case 'lesserRestoration'\|case 'magicWeapon'\|case 'cordonOfArrows'\|case 'alterSelf'\|case 'darkvision'\|case 'enhanceAbility'\|case 'flameBlade'\|case 'heatMetal'" src/engine/combat.ts` (should return 15 lines).
   - `grep -n "weapon_enchant\|enlarge_reduce" src/engine/spell_effects.ts` (should return ~6 lines — applySpellEffect + _undoEffect + query functions).
   - `grep -n "ticksRemaining\|saveDC\|saveAbility" src/engine/combat.ts` (should return ~6 lines — the damage_zone tick extensions).
3. Run the new test files: `npx ts-node --transpile-only src/test/{enlarge_reduce,enhance_ability,flame_blade,flaming_sphere,heat_metal,melf_s_acid_arrow,misty_step,invisibility,gust_of_wind,levitate,lesser_restoration,magic_weapon,cordon_of_arrows,alter_self,darkvision}.test.ts`. All 15 should print `Results: N passed, 0 failed`.
4. Pick the next batch of level-2 spells: `npm run spell-cache:pick -- --level 2 --source PHB --count 10`. Suggested: Scorching Ray, Ray of Enfeeblement, Shatter, Silence, Spider Climb (skip Rope Trick — out-of-combat; skip Pyrotechnics — two-mode complexity; skip Darkness — touches computeLOS, coordinate via TEAMGOALS.md).
5. Implement each spell following the architecture established in Session 15 + extended in Sessions 16 + 17 (documented above).
6. `npx tsc --noEmit` + run the full regression suite (must stay green — 119 test files, all 0 failures except pre-existing flakies).
7. `npm run spell-cache:build` — confirm the new spells show `implemented: true`.
8. Commit with message format `Cantrip-18: <summary>` (continuing the pivot-workstream prefix from Session 14/15/16/17).
9. Write `zHANDOVER-SESSION-19.md`.
10. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 17)

- `enlarge_reduce.test.ts`: 60/60 (NEW)
- `enhance_ability.test.ts`: 46/46 (NEW)
- `flame_blade.test.ts`: 43/43 (NEW)
- `flaming_sphere.test.ts`: 104/104 (NEW)
- `heat_metal.test.ts`: 108/108 (NEW)
- `melf_s_acid_arrow.test.ts`: 159/159 (NEW)
- `misty_step.test.ts`: 54/54 (NEW)
- `invisibility.test.ts`: 44/44 (NEW)
- `gust_of_wind.test.ts`: 52/52 (NEW)
- `levitate.test.ts`: 57/57 (NEW)
- `lesser_restoration.test.ts`: 47/47 (NEW)
- `magic_weapon.test.ts`: 53/53 (NEW)
- `cordon_of_arrows.test.ts`: 103/103 (NEW)
- `alter_self.test.ts`: 43/43 (NEW)
- `darkvision.test.ts`: 41/41 (NEW)
- Prior level-2 tests still green: `aid.test.ts` 43/43, `barkskin.test.ts` 38/38, `blur.test.ts` 32/32, `blindness_deafness.test.ts` 37/37, `branding_smite.test.ts` 44/44, `calm_emotions.test.ts` 41/41, `cloud_of_daggers.test.ts` 97/97, `crown_of_madness.test.ts` 40/40, `hold_person.test.ts` 42/42, `mirror_image.test.ts` 55/55
- Prior level-1 tests still green: `bless.test.ts` 37/37, `entangle.test.ts` 30/30, `faerie_fire.test.ts` 29/29, `magic_missile.test.ts` 25/25, `burning_hands.test.ts` 33/33, `sleep.test.ts` 35/35, `thunderwave.test.ts` 25/25, `arms_of_hadar.test.ts` 39/39, `dissonant_whispers.test.ts` 32/32, `shield_simple.test.ts` 12/12, `shield_of_faith.test.ts` 27/27, `mage_armor.test.ts` 21/21, `guiding_bolt.test.ts` 51/51, `healing_word.test.ts` 41/41, `healing_spells.test.ts` 36/36, `hex.test.ts` 27/27, `warding_bond.test.ts` 41/41
- Engine / AI / resources / scenario / etc. still green: `combat.test.ts` 48/48, `ai.test.ts` 26/26, `resources.test.ts` 72/72, `engine.test.ts` 71/71, `spell_effects.test.ts` 23/23, `mechanics.test.ts` 57/57, `concentration_ai.test.ts` 34/34, `cunning_action.test.ts` 53/53, `death_saves.test.ts` 57/57, `los.test.ts` 54/54, `mount.test.ts` 44/44, `mount_redirect.test.ts` 21/21, `parser.test.ts` 101/101, `pc.test.ts` 270/270, `scenario.test.ts` 94/94, `sneak_attack.test.ts` 23/23, `spell_actions.test.ts` 52/52, `summons.test.ts` 51/51, `day.test.ts` 54/54, `phase4.test.ts` 54/54, `integration.test.ts` 26/26, `character_builder.test.ts` 93/93, `character_improvements.test.ts` 51/51, `character_leveler.test.ts` 207/207, `character_storage.test.ts` 74/74, `adv_system.test.ts` 48/48, `bardic_inspiration.test.ts` 27/27, `html_report.test.ts` 36/36, `server.test.ts` 153/153, `healing.test.ts` 34/34, `rage.test.ts` 44/44, `roll_ability_check.test.ts` 96/96
- All 46 cantrip tests still green (verified via batch runs): `fire_bolt` 43, `acid_splash` 44, `poison_spray` 46, `vicious_mockery` 47, `sacred_flame` 51, `blade_ward` 38, `chill_touch` 38, `shocking_grasp` 26, `thorn_whip` 11, `eldritch_blast` 53, `toll_the_dead` 61, `mind_sliver` 48, `thunderclap` 54, `booming_blade` 218, `frostbite` 57, `sword_burst` 54, `sapping_sting` 50, `lightning_lure` 88, `green_flame_blade` 209, `word_of_radiance` 58, `produce_flame` 52, `infestation` 277, `shillelagh` 60, `create_bonfire` 99, `gust` 74, `primal_savagery` 57, `true_strike` 49, `resistance` 49, `magic_stone` 61, `spare_the_dying` 71, `light` 60, `minor_illusion` 55, `mage_hand` 62, `prestidigitation` 59, `thaumaturgy` 59, `mending` 64, `message` 60, `control_flames` 86, `dancing_lights` 102, `druidcraft` 95, `encode_thoughts` 103, `mold_earth` 106, `shape_water` 118, `friends` 53, `guidance` 52
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **87 implemented** (46 cantrips + 15 level-1 + 26 level-2 + 0 levels 3–9), 457 remaining in-scope.
- Pre-existing flaky tests (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work. (Note: all of these PASSED in Session 17's regression run — the "flaky" label means they SOMETIMES fail, not that they ALWAYS fail.)

---

## NOTES FOR NEXT AGENT

- **The cantrip-z workstream has PIVOTED TWICE.** Session 14: cantrip implementation → forward-compat subsystems (`rollAbilityCheck`). Session 15: forward-compat subsystems → level-2 spell implementation. Session 16: continued level-2 spell implementation (batch 2). Session 17: continued level-2 spell implementation with a DOUBLE-SIZED batch of 15 spells (batch 3, per user instruction). The forward-compat work (Options B/C/D/E/F) is tracked in `TEAMGOALS.md` as TG-001..TG-005 — read that file before starting any cross-workstream task.
- **`TEAMGOALS.md` is the single source of truth for cross-workstream coordination.** Per AGENTS.md PRIORITY RULE, the uploaded handover supersedes AGENTS.md. `TEAMGOALS.md` sits below the handover in authority but above `TASK.md`/`ROADMAP.md`. Any agent may append sections (use the template); edit only your own.
- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Session 17 introduced TWO new SpellEffectTypes: `weapon_enchant` and `enlarge_reduce`.** These are the first new effect types since Session 16's `damage_zone`. Both follow the "read at resolution time" pattern (no immediate side-effect in `applySpellEffect`; no-op in `_undoEffect` — the effect is just removed from the list, and the query functions naturally return 0/null).
- **Session 17 introduced the DAMAGE_ZONE SENTINEL PATTERN** for concentration-bound scratch-field buffs. When a spell sets a scratch field (e.g. `_flameBladeActive`) that needs concentration-break cleanup, the spell ALSO attaches a `damage_zone` effect with `dieCount: 0` (which the start-of-turn tick naturally skips). The `_undoEffect` function's `damage_zone` case checks for `dieCount === 0` and clears the matching scratch field based on `spellName`. This avoids the need for a per-spell concentration-break hook. Future concentration-bound scratch-field buffs should follow this pattern.
- **Session 17 EXTENDED the `damage_zone` payload** with `saveDC`, `saveAbility`, and `ticksRemaining`. These are all optional (backward-compatible with Cloud of Daggers). `saveDC` + `saveAbility` enable save-for-half damage zones (Flaming Sphere, Cordon of Arrows). `ticksRemaining` enables finite-tick damage zones (Melf's Acid Arrow = 1 tick, Cordon of Arrows = 4 ticks) — the start-of-turn tick decrements it and auto-removes the effect when it reaches 0. Future persistent-damage spells with saves or finite durations should use these payload fields.
- **Session 17 added hooks in `rollAbilityCheck` and `rollSave`** for Enlarge/Reduce (STR advantage/disadvantage) and Enhance Ability (any ability's checks advantage). These are the FIRST spells to modify ability checks since Session 14's `rollAbilityCheck` choke point was implemented (Guidance + Friends were the first consumers). Future spells that modify ability checks or saves should follow this pattern.
- **Session 17 added 4 new damage-branch hooks in `resolveAttack`:** Enlarge/Reduce (+1d8 enlarge / half reduce on weapon damage), Magic Weapon (+N to attack AND damage), Flame Blade (+3d6 fire on melee), Alter Self (regenerate unarmed-strike damage as 1d6 + STR). These join the existing Shillelagh, Branding Smite, and Hex hooks. Future weapon-damage-modifier spells should follow this pattern.
- **Session 17 added a new bonus-action planner branch (2.9 Misty Step).** This is the FIRST bonus-action spell branch since Branding Smite (2.8). Future bonus-action level-2 spells should follow the same pattern (return early from `planBonusAction`).
- **Session 17 FIXED the spell-cache build script's regex** for extracting `metadata.name`. The old regex `[^'"]+` broke on apostrophe-containing names (e.g. "Melf's Acid Arrow"). The new regex `("([^"]*)"|'([^']*)')` correctly handles apostrophes inside double-quoted strings. If a future spell has an apostrophe in its name, the cache will now detect it correctly.
- **Commit message convention:** `Cantrip-N: <summary>` (Session 14 was `Cantrip-14: ...rollAbilityCheck...`; Session 15 was `Cantrip-15: Pivot to Level-2 spells...`; Session 16 was `Cantrip-16: Implement <spell names>`; Session 17 was `Cantrip-17: Implement <spell names>`; Session 18 should be `Cantrip-18: Implement <spell names>`).
- **Pre-existing flaky tests** (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work. (Note: all of these PASSED in Session 17's regression run — the "flaky" label means they SOMETIMES fail, not that they ALWAYS fail.)
- **Architecture summary (level-2 spell pattern — established Session 15, extended Sessions 16 + 17):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (no-op for concentration spells AND for persistent-effect spells that don't use 1-round scratch flags).
  - Type changes: `PlannedAction.type` union + (if new effect type) `SpellEffectType` + `ActiveEffect.payload` + (if scratch flag) `Combatant._<flagName>`.
  - Engine: `combat.ts` case branch + (if shared computation change) `effectiveAC` / `resolveAttack` damage branch / `resolveAttack` pre-roll section + (if new start-of-turn effect) `runCombat` loop hook + (if scratch flag with 1-round duration) `utils.ts` `resetBudget` cleanup call + (if ability-check/save modifier) `utils.ts` `rollAbilityCheck` / `rollSave` hook.
  - Active-effect: `spell_effects.ts` (if new effect type) `applySpellEffect` + `_undoEffect` no-op cases + query function. (If scratch-field buff with concentration) damage_zone sentinel (dieCount=0) + `_undoEffect` spellName-specific cleanup.
  - Spell DB: `data/spells.ts` `SPELL_DB` entry.
  - AI planner: `planner.ts` branch in `planTurn` (action) or `planBonusAction` (bonus action).
  - Tests: `test/<snake_name>.test.ts` mirroring `aid.test.ts` / `branding_smite.test.ts` / `cloud_of_daggers.test.ts` pattern. Use deterministic save DCs for probabilistic outcomes. SIMULATE resolveAttack hooks rather than calling resolveAttack directly. Use `conditions: new Set() as Set<Condition>` (NOT `new Set<string>()`) in the makeCombatant helper.
- **All `Combatant` scratch fields added across Sessions 7–17:** (Session 14 list, plus Session 15 + 16 + 17 additions) `_mindSliverDiePenaltyNextSave?`, `_viciousMockeryDisadvNextAttack?`, `_frostbiteDisadvNextWeaponAttack?`, `_boomingBladePendingDamageDice?`, `_chillTouchNoHealing?` + `_chillTouchUndeadDisadv?`, `_rayOfFrostSpeedReduction?`, `_thornWhipPullPending?`, `_infestationMovePending?`, `_shockingGraspNoReaction?`, `_sappingStingProneApplied?`, `_lightningLurePullPending?`, `_greenFlameBladeSplashPending?`, `_gustPushPending?`, `_shillelaghActive?`, `_trueStrikeAdvNextAttack?`, `_resistanceDieBonusNextSave?`, `_guidanceDieBonusNextAbilityCheck?`, `_friendsAdvNextChaCheck?`, `_lightSourceActive?`, `_isStabilized?`, `_mended?`, **`_aidHPBonus?` (Session 15 — forward-compat only)**, **`_brandingSmiteActive?` (Session 15 — consumed by `resolveAttack`)**, **`_mirrorImageDuplicates?` (Session 16 — consumed by `resolveAttack` pre-roll retargeting hook)**, **`_enlargeReduceActive?` (Session 17 — RESERVED, modeled via ActiveEffect)**, **`_enhanceAbilityActive?` (Session 17 — consumed by `rollAbilityCheck`)**, **`_flameBladeActive?` (Session 17 — consumed by `resolveAttack` damage branch)**, **`_magicWeaponBonus?` (Session 17 — RESERVED, modeled via ActiveEffect)**, **`_alterSelfActive?` (Session 17 — consumed by `resolveAttack` damage branch)**, **`_darkvisionActive?` (Session 17 — forward-compat only)**. Optional with sensible defaults.
- **SpellEffectType registry (updated Session 17):** `advantage_vs`, `ac_bonus`, `ac_floor`, `bless_die`, `condition_apply`, `hex_damage`, `damage_zone`, **`weapon_enchant` (Session 17 — NEW)**, **`enlarge_reduce` (Session 17 — NEW)**.
- **ActiveEffect.payload fields (updated Session 17):** `advType?`, `advScope?`, `acBonus?`, `acFloor?`, `dieSides?`, `condition?`, `hexDie?`, `dieCount?` (Session 16), `damageType?` (Session 16), **`saveDC?` (Session 17 — NEW, for damage_zone)**, **`saveAbility?` (Session 17 — NEW, for damage_zone)**, **`ticksRemaining?` (Session 17 — NEW, for damage_zone)**, **`attackBonus?` (Session 17 — NEW, for weapon_enchant)**, **`damageBonus?` (Session 17 — NEW, for weapon_enchant)**, **`enlargeReduceMode?` (Session 17 — NEW, for enlarge_reduce)**.
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
  - Session 17: THIRD level-2 spell batch — DOUBLE-SIZED (15 spells: Enlarge/Reduce, Enhance Ability, Flame Blade, Flaming Sphere, Heat Metal, Melf's Acid Arrow, Misty Step, Invisibility, Gust of Wind, Levitate, Lesser Restoration, Magic Weapon, Cordon of Arrows, Alter Self, Darkvision)
  - Session 17: FIRST `weapon_enchant` `SpellEffectType` (Magic Weapon — flat +N to attack AND damage rolls)
  - Session 17: FIRST `enlarge_reduce` `SpellEffectType` (Enlarge/Reduce — +1d8/half weapon damage + STR adv/disadv)
  - Session 17: FIRST damage_zone save-for-half (Flaming Sphere, Cordon of Arrows — `saveDC` + `saveAbility` payload)
  - Session 17: FIRST damage_zone finite-tick (Melf's Acid Arrow = 1 tick, Cordon of Arrows = 4 ticks — `ticksRemaining` payload)
  - Session 17: FIRST delayed-damage spell (Melf's Acid Arrow — 4d4 immediate + 2d4 at start of next turn via damage_zone with ticksRemaining: 1)
  - Session 17: FIRST damage_zone sentinel pattern (Flame Blade, Alter Self, Enhance Ability — dieCount=0 anchors concentration-break cleanup for scratch fields)
  - Session 17: FIRST ability-check-advantage spell via `rollAbilityCheck` choke point other than Guidance/Friends (Enhance Ability — `_enhanceAbilityActive` scratch field; Enlarge/Reduce — `enlarge_reduce` ActiveEffect for STR)
  - Session 17: FIRST STR-save-advantage spell other than Rage (Enlarge/Reduce — `enlarge_reduce` ActiveEffect queried in `rollSave`)
  - Session 17: FIRST teleport spell (Misty Step — bonus action, sets `caster.pos`)
  - Session 17: FIRST push spell (Gust of Wind — STR save, sets `target.pos` away from caster)
  - Session 17: FIRST condition-removal spell ending non-charm/frighten conditions (Lesser Restoration — ends blinded/deafened/paralyzed/poisoned)
  - Session 17: FIRST weapon-damage-substitution spell (Alter Self — regenerates unarmed-strike damage as 1d6 + STR)
  - Session 17: FIRST bonus-action level-2 spell other than Branding Smite (Misty Step — section 2.9 in planBonusAction)
  - Session 17: FIRST spell-cache build.ts regex fix (apostrophe-containing names like "Melf's Acid Arrow")
- **CANTRIP IMPLEMENTATION WORKSTREAM IS COMPLETE.** All 46 in-scope cantrips implemented (Session 13). Session 14 pivoted to forward-compat subsystems (`rollAbilityCheck` — Option A, DONE). Session 15 pivoted to level-2 spell implementation (5 PHB level-2 spells, DONE) AND created `TEAMGOALS.md`. Session 16 continued level-2 spell implementation (5 more PHB level-2 spells, DONE). Session 17 continued level-2 spell implementation with a DOUBLE-SIZED batch of 15 PHB level-2 spells (DONE). Session 18+ should continue level-2 spell implementation (standard 5-spell batches).

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
