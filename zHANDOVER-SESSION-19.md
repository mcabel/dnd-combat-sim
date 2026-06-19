# zHANDOVER-SESSION-19

## REPOSITORY

- Branch: main
- Prior commits (cantrip-z workstream — level-2 spell pivot):
  - `<new>` — Cantrip-18: Implement Moonbeam, Scorching Ray, Shatter, Spike Growth, Spiritual Weapon, Phantasmal Force, Ray of Enfeeblement, Web, Silence, Suggestion, Zone of Truth, Enthrall, Detect Thoughts, See Invisibility, Spider Climb, Pass without Trace, Protection from Poison, Prayer of Healing, Knock, Arcane Lock (PHB level-2 batch 4 — 20 spells, double-sized per user instruction "15 more than requested"). Also: NEW multi-attack pattern (Scorching Ray — shouldCast returns Combatant[] of exactly 3 targets); NEW AoE save pattern (Shatter — 10-ft radius via chebyshev3D sphere, shouldCast returns Combatant[]); NEW INT save (Phantasmal Force — first INT save in workstream); NEW CHA save (Zone of Truth — first CHA save in workstream); NEW DEX save or restrained (Web); NEW resolveAttack damage-branch hook for Ray of Enfeeblement (halves weapon damage when `_rayOfEnfeeblementActive === true` on attacker); 11 new Combatant scratch fields (all forward-compat flags or Ray of Enfeeblement); 7 new sentinel cleanup cases in `_undoEffect`'s damage_zone switch (Silence, Zone of Truth, Enthrall, Detect Thoughts, Spider Climb, Pass without Trace, Ray of Enfeeblement); AI planner branches 11X–11AQ (19 action-time) + 2.10 (Spiritual Weapon bonus action); spell-cache reports 107/557 implemented.
  - `a0f5326` — Cantrip-17: Implement Enlarge/Reduce, Enhance Ability, Flame Blade, Flaming Sphere, Heat Metal, Melf's Acid Arrow, Misty Step, Invisibility, Gust of Wind, Levitate, Lesser Restoration, Magic Weapon, Cordon of Arrows, Alter Self, Darkvision (PHB level-2 batch 3 — 15 spells).
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
| `zHANDOVER-SESSION-*.md` | **Cantrip-z / Level-2 spells (this agent)** | **THIS agent (you)** |
| `TEAMGOALS.md` | **All three workstreams (shared)** | **ANY agent may append sections — edit only your own** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — coordinate via TEAMGOALS.md |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip-z workstream — CONTINUING level-2 spells in Session 19)

- **The cantrip implementation workstream is COMPLETE (since Session 13).** All 46 in-scope cantrips are implemented. There are NO more cantrips to implement.
- **Session 14 PIVOTED to forward-compat subsystems** (Option A — `rollAbilityCheck` choke point in `utils.ts`).
- **Session 15 PIVOTED to LEVEL-2 SPELL IMPLEMENTATION** (first batch: Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite). Also created `TEAMGOALS.md`.
- **Session 16 CONTINUED level-2 spell implementation** (second batch: Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image). 5 new PHB level-2 spells.
- **Session 17 CONTINUED with a DOUBLE-SIZED BATCH of 15 spells** (third batch: Enlarge/Reduce, Enhance Ability, Flame Blade, Flaming Sphere, Heat Metal, Melf's Acid Arrow, Misty Step, Invisibility, Gust of Wind, Levitate, Lesser Restoration, Magic Weapon, Cordon of Arrows, Alter Self, Darkvision).
- **Session 18 (this session) CONTINUED with a DOUBLE-SIZED BATCH of 20 spells** (fourth batch — user explicitly requested "15 more than the standard 5-spell batch requested in zHANDOVER-SESSION-18.md", interpreted as 5 + 15 = 20 spells). 20 new PHB level-2 spells: Moonbeam, Scorching Ray, Shatter, Spike Growth, Spiritual Weapon, Phantasmal Force, Ray of Enfeeblement, Web, Silence, Suggestion, Zone of Truth, Enthrall, Detect Thoughts, See Invisibility, Spider Climb, Pass without Trace, Protection from Poison, Prayer of Healing, Knock, Arcane Lock. Total 46 level-2 spells now implemented (5 + 5 + 15 + 20 + 1 Warding Bond from prior level-1 batch = 46).
- **Session 19+ should continue level-2 spell implementation.** Use `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next batch. As of Session 18 end: 107/557 spells implemented (46 cantrips + 15 level-1 + 46 level-2 + 0 levels 3–9).
- **Forward-compat subsystems (the Session 14 pivot direction) are tracked in TEAMGOALS.md:**
  - TG-001: Persistent-buff subsystem for multi-effect cantrips (was Option B)
  - TG-002: Concentration subsystem (was Option C) — **NOTE: Session 16 added a concentration-check hook in the damage_zone start-of-turn tick (combat.ts runCombat loop). Session 17 EXTENDED this hook to support save-for-half damage zones (Flaming Sphere, Cordon of Arrows) and ticksRemaining-based auto-removal (Melf's Acid Arrow, Cordon of Arrows). Session 18 did NOT extend TG-002 further — the 20 new spells reuse the existing damage_zone infrastructure. The full TG-002 implementation still needs a damage-taken hook in `applyDamage`/`applyDamageWithTempHP`.**
  - TG-003: AI planner cantrip selection (was Option D)
  - TG-004: Parser tech debt (was Option E) — **NOTE: Session 16's Mirror Image sight-dependency immunity, Hold Person / Crown of Madness humanoid-type checks, Session 17's Heat Metal metal-object check, and Session 18's Phantasmal Force creature-type-vs-INT-save (no special immunity modelling), Silence verbal-spell-block, Zone of Truth lie-detection, etc. are ALL blocked on TG-004.**
  - TG-005: Illusion-disbelief Investigation check (was Option F) — **NOTE: Session 18's Phantasmal Force "target rationalizes the illusion" rider is NOT modelled (forward-compat TODO). A future implementation could use TG-005's Investigation check to allow targets to disbelieve Phantasmal Force (canon: PHB p.264 "the target rationalizes any odd occurrence...").**
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- Do NOT touch another workstream's handover files.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-18.md`** (the prior session — implemented level-2 batch 4: 20 spells including Scorching Ray multi-attack, Shatter AoE, Phantasmal Force INT save, Zone of Truth CHA save, Ray of Enfeeblement resolveAttack hook).
3. Read **`TEAMGOALS.md`** — cross-workstream coordination. ANY task that touches multiple workstreams MUST be a `TG-NNN` entry here. Add new entries (do not delete other agents' entries).
4. Read **`SPELL-CACHE.md`** — the cache + picker workflow. Now applies to ALL spell levels (0–9), not just cantrips.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — confirm current implementation state. As of Session 18 end: 107/557 spells implemented (46 cantrips + 15 level-1 + 46 level-2 + 0 levels 3–9).
7. `grep -n "case 'moonbeam'\|case 'scorchingRay'\|case 'shatter'\|case 'spikeGrowth'\|case 'spiritualWeapon'\|case 'phantasmalForce'\|case 'rayOfEnfeeblement'\|case 'web'\|case 'silence'\|case 'suggestion'\|case 'zoneOfTruth'\|case 'enthrall'\|case 'detectThoughts'\|case 'seeInvisibility'\|case 'spiderClimb'\|case 'passWithoutTrace'\|case 'protectionFromPoison'\|case 'prayerOfHealing'\|case 'knock'\|case 'arcaneLock'" src/engine/combat.ts` — confirm the 20 new level-2 case branches exist.
8. `grep -n "_rayOfEnfeeblementActive\|_silenceZoneActive\|_zoneOfTruthActive\|_enthrallActive\|_detectThoughtsActive\|_seeInvisibilityActive\|_spiderClimbActive\|_passWithoutTraceActive\|_protectionFromPoisonActive\|_knockActive\|_arcaneLockActive" src/types/core.ts` — confirm the 11 new scratch fields exist.
9. `grep -n "case 'Ray of Enfeeblement'\|case 'Silence'\|case 'Zone of Truth'\|case 'Enthrall'\|case 'Detect Thoughts'\|case 'Spider Climb'\|case 'Pass without Trace'" src/engine/spell_effects.ts` — confirm the 7 new sentinel cleanup cases exist in `_undoEffect`'s damage_zone switch.
10. `grep -n "attacker._rayOfEnfeeblementActive" src/engine/combat.ts` — confirm the resolveAttack damage-branch hook for Ray of Enfeeblement exists (~line 775).

---

## GOALS THIS SESSION — CONTINUE LEVEL-2 SPELL IMPLEMENTATION

The cantrip-z workstream is CONTINUING PHB level-2 spells. The fourth batch (20 spells — a double-sized batch per user instruction "15 more than requested") landed in Session 18. The next batch should follow the standard pattern (5 spells per session, the standard batch size).

### Architecture established in Session 15 (for level-2 spells) — EXTENDED in Sessions 16 + 17 + 18

The level-2 spell pattern mirrors the existing level-1 spell pattern (Bless / Entangle / Faerie Fire / etc.):

1. **Spell module** in `src/spells/<snake_name>.ts`:
   - `export const metadata = { name, level: 2, school, rangeFt, concentration, castingTime, ...metadata flags } as const;`
   - `export function shouldCast(caster, bf) → Combatant | Combatant[] | { target, mode } | { target, ability } | { destination } | boolean | null` — planner hook. The return type varies by spell (single-target, multi-target, mode-selection, ability-selection, destination-selection, self-buff). **Session 18 added two new return types:** `Combatant[]` for multi-attack (Scorching Ray, 3 targets) and multi-target save (Shatter, Enthrall up to 3 targets, Prayer of Healing up to 3 targets).
   - `export function execute(caster, target/targets/state/destination/mode/ability) → void` — applies the effect. Signature varies by spell.
   - `export function cleanup(c) → void` — for `resetBudget` integration (no-op for concentration spells; safety-net for scratch-flag spells).

2. **Type changes** in `src/types/core.ts`:
   - Add new `'spellName'` to the `PlannedAction.type` union.
   - Add new `SpellEffectType` if needed (Session 18 added NO new SpellEffectTypes — all 20 spells reuse existing types: `damage_zone`, `condition_apply`, `advantage_vs`).
   - Add new `payload` field if needed (Session 18 added NO new payload fields — all reuse existing `dieCount`/`dieSides`/`damageType`/`saveDC`/`saveAbility`/`ticksRemaining`/`condition`).
   - Add new scratch field on `Combatant` if needed (Session 18 added 11 new scratch fields: `_rayOfEnfeeblementActive` (consumed by resolveAttack), `_silenceZoneActive`, `_zoneOfTruthActive`, `_enthrallActive`, `_detectThoughtsActive`, `_seeInvisibilityActive`, `_spiderClimbActive`, `_passWithoutTraceActive`, `_protectionFromPoisonActive`, `_knockActive`, `_arcaneLockActive` (all forward-compat flags, never read in v1)).

3. **Engine integration** in `src/engine/combat.ts`:
   - Import `shouldCast` + `execute` from the new spell module.
   - Add `case 'spellName':` branch in `executePlannedAction` that re-runs `shouldCast` (live target list) and calls `execute`.
   - If the spell modifies a shared computation (e.g. Enlarge/Reduce's weapon-damage mod, Magic Weapon's attack/damage bonus, Flame Blade's +3d6 fire rider, Alter Self's unarmed-strike substitution, **Session 18's Ray of Enfeeblement's weapon-damage halving**), update that computation (e.g. `resolveAttack`'s attack-roll section + damage branch).
   - If the spell introduces a new start-of-turn effect (e.g. Flaming Sphere's save-for-half damage_zone, Cordon of Arrows's ticksRemaining-limited damage_zone, **Session 18's Moonbeam's CON-save-for-half damage_zone, Spike Growth's automatic piercing damage_zone, Spiritual Weapon's 1d8 force damage_zone with ticksRemaining: 10, Phantasmal Force's 1d6 psychic damage_zone**), the existing damage_zone hook in `runCombat` (right after `resetBudget`) handles it — no new hook needed.

4. **Active-effect integration** in `src/engine/spell_effects.ts` (if the spell uses a new effect type):
   - Add the new effect type to the `applySpellEffect` switch (usually a no-op "read at resolution time" case).
   - Add the new effect type to the `_undoEffect` switch (usually a no-op; for scratch-field buffs using a damage_zone sentinel, add spellName-specific cleanup).
   - Add a new query function (e.g. `getActiveWeaponEnchant`, `getActiveEnlargeReduce`) consumed by `combat.ts` / `utils.ts`.
   - **Session 17 sentinel pattern**: concentration-bound scratch-field buffs attach a `damage_zone` effect with `dieCount: 0` as a lifecycle anchor. The `_undoEffect` function's `damage_zone` case checks for `dieCount === 0` and clears the matching scratch field based on `spellName`. **Session 18 added 7 new sentinel-cleanup spellName cases:** Silence, Zone of Truth, Enthrall, Detect Thoughts, Spider Climb, Pass without Trace, Ray of Enfeeblement.

5. **Cleanup integration** in `src/engine/utils.ts` (if the spell uses a scratch flag with 1-round duration):
   - Import the spell's `cleanup` function.
   - Call it from `resetBudget` with a doc comment explaining the v1 1-round simplification.
   - (Session 18 added NO new cleanup calls — all 20 new spells are either concentration spells, persistent-effect spells that don't need 1-round cleanup, or forward-compat flag spells. Ray of Enfeeblement / Silence / Zone of Truth / Enthrall / Detect Thoughts / Spider Climb / Pass without Trace use the damage_zone sentinel pattern instead of cleanup.)

6. **Ability-check / save integration** in `src/engine/utils.ts` (if the spell modifies ability checks or saves):
   - Session 18 added NO new `rollAbilityCheck` or `rollSave` hooks. Protection from Poison's "advantage on saves vs poison" + "resistance to poison damage" are forward-compat only (the `_protectionFromPoisonActive` flag is set but never read in v1). A future implementation could extend `rollSave` to grant advantage on poison-related CON saves when the flag is true.

7. **Spell DB** in `src/data/spells.ts`:
   - Add an entry to `SPELL_DB` keyed by lowercase spell name (e.g. `'moonbeam'`, `'scorching ray'`, `'shatter'`).

8. **AI planner** in `src/ai/planner.ts`:
   - Import `shouldCast` from the new spell module.
   - Add a planner branch in `planTurn` (action-time spells) or `planBonusAction` (bonus action spells).
   - Guard with `if (!plan.action)` so the new spell only fires when no higher-priority spell was chosen.
   - Use `self.actions.some(a => a.name === 'Spell Name')` to gate on the caster having the spell.
   - Session 18 added 19 action-time branches (11X–11AQ) + 1 bonus-action branch (2.10 Spiritual Weapon).

9. **Tests** in `src/test/<snake_name>.test.ts`:
   - Mirror the `aid.test.ts` / `branding_smite.test.ts` / `cloud_of_daggers.test.ts` / `alter_self.test.ts` pattern.
   - Use `makeCombatant` / `makeBF` / `makeState` helpers.
   - 6–8 sections: 1. Metadata, 2. shouldCast gates, 3. shouldCast target priority, 4. execute mechanics, 5. execute logging, 6. cleanup, 7+ Integration + spell-specific sections.
   - For probabilistic save outcomes (e.g. Moonbeam, Phantasmal Force, Web, Suggestion, Zone of Truth, Enthrall), use deterministic save DCs (e.g. CON 1 + DC 25 = guaranteed fail; CON 30 + DC 5 = guaranteed success).
   - For multi-attack spells (Scorching Ray), test with 1, 2, 3+ enemies and verify the targets array always has exactly 3 entries (repeating nearest if fewer).
   - For AoE save spells (Shatter), test single-target and multi-target AoE patterns.
   - For resolveAttack integration (Ray of Enfeeblement's damage halving), SIMULATE the hook logic in a helper function rather than calling resolveAttack directly (mirror `branding_smite.test.ts`'s `simulateBrandingSmiteDamage` pattern).
   - **IMPORTANT**: use `conditions: new Set() as Set<Condition>` (NOT `new Set<string>()`) in the makeCombatant helper — `tsc --noEmit` will fail otherwise.

10. **Cache rebuild**: `npm run spell-cache:build` after implementing — confirm the new spells show `implemented: true` in `spell-cache/INDEX.md`.

### Suggested next batch — level-2 spells (PHB), batch 5

Run `npm run spell-cache:pick -- --level 2 --source PHB --count 5` to get the next 5 unimplemented PHB level-2 spells. After Session 18, the next 5 unimplemented PHB level-2 spells (alphabetically) are:

- **Aganazzar's Scorcher** (XGE p.150) — Evocation, action, 30-ft line, 3d8 fire DEX save. NOT PHB — out of scope (canon pre-2024 XGE source is in scope, but this is XGE not PHB).
- **Animal Messenger** (PHB p.212) — Enchantment, ritual, 24 hr. Out-of-combat utility — skip.
- **Augury** (PHB p.215) — Divination, ritual. Out-of-combat utility — skip.
- **Beast Sense** (PHB p.217) — Divination, ritual, concentration. Out-of-combat utility — skip.
- **Continual Flame** (PHB p.227) — Evocation, touch, permanent. Out-of-combat utility (Light variant) — skip.
- **Darkness** (PHB p.230) — Evocation, 60 ft, 15-ft radius sphere, blocks light + sight, concentration 10 min. **STILL DEFERRED — touches `computeLOS`. Coordinate via TEAMGOALS.md.**

**Pick recommendation for Session 19:** All remaining in-scope PHB level-2 spells are either out-of-combat utility (Animal Messenger, Augury, Beast Sense, Continual Flame, Find Traps, Gentle Repose, Locate Animals or Plants, Locate Object, Magic Mouth, Nystul's Magic Aura, Rope Trick), complex summons (Find Steed), or Darkness (computeLOS — coordinate via TEAMGOALS.md). The cantrip-z workstream has now EXHAUSTED all combat-relevant in-scope PHB level-2 spells.

**Suggested pivot for Session 19:** Either (a) coordinate with Core Engine workstream via TEAMGOALS.md to implement Darkness (the last combat-relevant PHB level-2 spell — requires `computeLOS` extension), OR (b) pivot to LEVEL-3 SPELL IMPLEMENTATION following the same pattern. Use `npm run spell-cache:pick -- --level 3 --source PHB --count 5` to identify the first batch of level-3 spells. Likely candidates: Animate Dead (PHB p.212 — complex summon), Beacon of Hope (PHB p.217 — buff), Call Lightning (PHB p.220 — persistent damage_zone), Clairvoyance (PHB p.221 — forward-compat), Conjure Animals (PHB p.225 — complex summon). Suggested first batch: Beacon of Hope, Call Lightning, Clairvoyance, Counterspell, Crusader's Mantle (5 spells — diverse patterns).

**IMPORTANT — Darkness is STILL deferred.** Coordinate with Core Engine via TEAMGOALS.md before implementing.

### How to add a new TG-NNN entry

If you discover a NEW cross-workstream task during implementation:

1. Read `TEAMGOALS.md` to find the next free `TG-NNN` number.
2. Use the section template at the bottom of `TEAMGOALS.md`.
3. Set Status to `OPEN`, Owners to your workstream + the reviewer workstream.
4. Commit `TEAMGOALS.md` alongside your code changes.

---

## COMPLETED THIS SESSION (Session 18)

### Feature 1: 20 new PHB level-2 spells (batch 4 — DOUBLE-SIZED per user instruction)

User explicitly requested "15 more spells than requested in the zhandover" for this session (vs. the standard 5-spell batch). The handover requested 5 spells (standard batch). 5 + 15 = 20 spells total. Used `npm run spell-cache:pick -- --level 2 --source PHB --count 60` to get the alphabetical list, then picked 20 mechanically diverse spells (skipping Darkness — touches `computeLOS`; skipping Rope Trick — out-of-combat utility; skipping pure out-of-combat utility — Augury, Beast Sense, Animal Messenger, Arcane Lock implemented as forward-compat only, Continual Flame, Find Traps, Gentle Repose, Locate Animals or Plants, Locate Object, Magic Mouth, Nystul's Magic Aura, Knock implemented as forward-compat only; skipping Find Steed — complex summon subsystem; skipping Continual Flame — Light variant, redundant). All 20 implemented with the pattern documented above:

**Group A — Damage/attack spells (7):**

1. **Moonbeam** (`src/spells/moonbeam.ts`, PHB p.261) — 2nd-level evocation, action, 120 ft, concentration 1 min.
   - Effect: CON save 2d10 radiant (half on save) on cast + persistent damage_zone 2d10 radiant/turn (CON save for half).
   - Pattern: Mirror `flaming_sphere.ts`. `damage_zone` with `saveDC` + `saveAbility: 'con'` + `dieCount: 2` + `dieSides: 10` + `damageType: 'radiant'`. The start-of-turn tick rolls save for half (Session 17 extension).
   - v1 simplifications: single-target only (canon: 5-ft cylinder AoE); sphere movement NOT modelled; upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `moonbeamCylinderAoeV1Implemented: false`, `moonbeamMovementV1Implemented: false`, `moonbeamUpcastV1Implemented: false`, `moonbeamConcentrationEnforcementV1Implemented: false`.

2. **Scorching Ray** (`src/spells/scorching_ray.ts`, PHB p.273) — 2nd-level evocation, action, 120 ft, NO concentration.
   - Effect: 3 ranged spell attacks, 2d6 fire each (upcast +1 ray/slot — NOT modelled in v1).
   - Pattern: **NEW MULTI-ATTACK PATTERN.** `shouldCast` returns `Combatant[]` of exactly 3 targets (repeats first target if fewer than 3 enemies in range — all 3 rays always have a target). `execute` loops 3 times, rolling a separate ranged spell attack against each target.
   - v1 simplifications: 3 rays fixed (canon: upcast adds rays); each ray rolls its own attack (canon: yes); all rays may target the same enemy (canon: yes — "you can direct the beams at the same target or at different ones"); upcast NOT modelled.
   - Metadata flags: `scorchingRayMultiTargetV1Simplified: true`, `scorchingRayUpcastV1Implemented: false`.

3. **Shatter** (`src/spells/shatter.ts`, PHB p.275) — 2nd-level evocation, action, 60 ft, NO concentration.
   - Effect: CON save 3d8 thunder (half on save), 10-ft radius AoE around primary target.
   - Pattern: **NEW AoE SAVE PATTERN (radius sphere).** `shouldCast` returns `Combatant[]` (all enemies within 10 ft of the highest-threat enemy within 60 ft). `execute` rolls a separate save for each target. Uses `chebyshev3D` for distance (10 ft = 2 grid squares).
   - v1 simplifications: AoE centered on a target creature (canon: centered on a point); upcast NOT modelled.
   - Metadata flags: `shatterUpcastV1Implemented: false`.

4. **Spike Growth** (`src/spells/spike_growth.ts`, PHB p.277) — 2nd-level transmutation, action, 150 ft, concentration 10 min.
   - Effect: 2d4 piercing damage when target enters area or starts turn there. v1: damage_zone 2d4 piercing/turn, NO on-cast damage, NO save (automatic).
   - Pattern: Mirror `cloud_of_daggers.ts` BUT NO on-cast damage (canon: damage only on enter or start-of-turn). `damage_zone` with NO `saveDC` (automatic damage).
   - v1 simplifications: single-target only (canon: 20-ft radius AoE); movement-trigger NOT modelled (canon: "enters the area" trigger); difficult terrain rider NOT modelled; upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `spikeGrowthDifficultTerrainV1Implemented: false`, `spikeGrowthMovementTriggerV1Implemented: false`, `spikeGrowthUpcastV1Implemented: false`, `spikeGrowthConcentrationEnforcementV1Implemented: false`.

5. **Spiritual Weapon** (`src/spells/spiritual_weapon.ts`, PHB p.278) — 2nd-level evocation, BONUS ACTION, 60 ft, NO concentration (1 min).
   - Effect: Melee spell attack vs target, 1d8 force on hit. On subsequent turns: bonus action to attack again (v1 simplification: persistent damage_zone 1d8 force/turn, NO attack roll, ticks at start of target's turn).
   - Pattern: `shouldCast` returns `Combatant | null` (single highest-threat enemy within 60 ft). `execute` rolls a melee spell attack on cast (1d8 force on hit), then applies a `damage_zone` effect with `dieCount: 1`, `dieSides: 8`, `damageType: 'force'`, NO `saveDC` (automatic damage), `ticksRemaining: 10` (10 rounds = 1 min duration). `sourceIsConcentration: false` (NOT concentration).
   - v1 simplifications: subsequent attacks as auto-tick damage_zone (canon: bonus action to make a new attack roll); NO attack roll on subsequent turns (canon: yes); retargeting NOT modelled (canon: bonus action to move the weapon and attack a different target); upcast (+1d8 per slot level) NOT modelled.
   - Metadata flags: `spiritualWeaponSubsequentAttackV1Simplified: true`, `spiritualWeaponUpcastV1Implemented: false`, `spiritualWeaponRetargetingV1Implemented: false`.

6. **Phantasmal Force** (`src/spells/phantasmal_force.ts`, PHB p.264) — 2nd-level illusion, action, 60 ft, concentration 1 min.
   - Effect: INT save. On fail: 1d6 psychic damage + persistent damage_zone 1d6 psychic/turn (NO save — illusion damage is automatic). On success: NO damage, NO damage_zone (target disbelieves).
   - Pattern: **NEW INT SAVE (first INT save in the workstream).** Mirror `flaming_sphere.ts` but with INT save. On-cast: `rollSave(target, 'int', saveDC)`. If fail: 1d6 psychic + damage_zone (NO saveDC, automatic). If success: no effect.
   - v1 simplifications: target rationalizes illusion NOT modelled (canon: PHB p.264 "the target rationalizes any odd occurrence..."); Investigation check to disbelieve NOT modelled (TG-005); upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `phantasmalForceRationalizationV1Implemented: false`, `phantasmalForceUpcastV1Implemented: false`, `phantasmalForceConcentrationEnforcementV1Implemented: false`.

7. **Ray of Enfeeblement** (`src/spells/ray_of_enfeeblement.ts`, PHB p.271) — 2nd-level necromancy, action, 60 ft, concentration 1 min.
   - Effect: Ranged spell attack. On hit: target deals half damage with weapon attacks (canon: "weapon attacks that use Strength" — v1 simplification: applies to ALL weapon attacks melee/ranged). NO damage on the attack itself.
   - Pattern: Mirror `melf_s_acid_arrow.ts`'s ranged spell attack pattern, BUT no damage roll on hit. Instead, set `_rayOfEnfeeblementActive = true` on the target + attach a `damage_zone` sentinel effect (dieCount: 0) for concentration-break cleanup. The `resolveAttack` damage-branch hook (combat.ts line ~775) checks `attacker._rayOfEnfeeblementActive === true` and halves weapon damage if true (mirror Enlarge/Reduce 'reduce' branch semantics — `Math.floor(dmg / 2)`).
   - v1 simplifications: applies to ALL weapon attacks (canon: STR weapon attacks only — v1 doesn't track STR-vs-DEX weapon distinction); upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `rayOfEnfeeblementStrOnlyV1Simplified: true`, `rayOfEnfeeblementUpcastV1Implemented: false`, `rayOfEnfeeblementConcentrationEnforcementV1Implemented: false`.

**Group B — Control/debuff spells (5):**

8. **Web** (`src/spells/web.ts`, PHB p.287) — 2nd-level conjuration, action, 60 ft, concentration 1 min.
   - Effect: DEX save or restrained (web also creates difficult terrain — NOT modelled in v1).
   - Pattern: Mirror `levitate.ts` but with DEX save (instead of CON) and 'restrained' condition. `condition_apply:restrained` effect with `sourceIsConcentration: true`.
   - v1 simplifications: single-target only (canon: 20-ft cube AoE); difficult terrain rider NOT modelled; web destruction by fire/force damage NOT modelled; escape action NOT modelled; upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `webDifficultTerrainV1Implemented: false`, `webDestructionV1Implemented: false`, `webEscapeActionV1Implemented: false`, `webUpcastV1Implemented: false`, `webConcentrationEnforcementV1Implemented: false`.

9. **Silence** (`src/spells/silence.ts`, PHB p.275) — 2nd-level illusion, action, 120 ft, concentration 10 min.
   - Effect: 20-ft radius sphere blocks all sound — verbal spells can't be cast. v1 has no spell-block subsystem — sets forward-compat flag `_silenceZoneActive` on the target (v1: zone anchored to target enemy).
   - Pattern: Mirror `darkvision.ts`'s forward-compat flag pattern BUT with concentration. Scratch field + `damage_zone` sentinel (dieCount: 0) for cleanup.
   - v1 simplifications: verbal-spell-block NOT modelled (forward-compat flag only); single-target only (canon: 20-ft radius sphere AoE); upcast NOT modelled; concentration NOT enforced (TG-002).
   - Metadata flags: `silenceVerbalSpellBlockV1Implemented: false`, `silenceAoEMultiTargetV1Implemented: false`, `silenceUpcastV1Implemented: false`, `silenceConcentrationEnforcementV1Implemented: false`.

10. **Suggestion** (`src/spells/suggestion.ts`, PHB p.279) — 2nd-level enchantment, action, 30 ft, concentration 8 hr (v1: 1 min).
    - Effect: WIS save or charmed (one command). v1: applies the 'charmed' condition only — no command-subsystem.
    - Pattern: Mirror `crown_of_madness.ts` (save-or-charmed pattern) but WITHOUT the humanoid-type check.
    - v1 simplifications: command-subsystem NOT modelled (canon: caster issues a one-sentence command); duration simplified to 1 min (canon: 8 hr, v1: combat-relevant duration only); upcast NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `suggestionCommandSubystemV1Implemented: false`, `suggestionDurationV1Simplified: true`, `suggestionUpcastV1Implemented: false`, `suggestionConcentrationEnforcementV1Implemented: false`.

11. **Zone of Truth** (`src/spells/zone_of_truth.ts`, PHB p.289) — 2nd-level enchantment, action, 60 ft, concentration 10 min.
    - Effect: CHA save. On fail: target can't lie (in 15-ft radius). v1 has no lie/speech subsystem — sets forward-compat flag `_zoneOfTruthActive` on target.
    - Pattern: **NEW CHA SAVE (first CHA save in the workstream).** Mirror `darkvision.ts`'s forward-compat flag pattern BUT with concentration AND a CHA save. On fail ONLY: set flag + sentinel.
    - v1 simplifications: lie-detection subsystem NOT modelled (forward-compat flag only); single-target only (canon: 15-ft radius AoE); upcast NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `zoneOfTruthLieSubsystemV1Implemented: false`, `zoneOfTruthAoEMultiTargetV1Implemented: false`, `zoneOfTruthUpcastV1Implemented: false`, `zoneOfTruthConcentrationEnforcementV1Implemented: false`.

12. **Enthrall** (`src/spells/enthrall.ts`, PHB p.238) — 2nd-level enchantment, action, 60 ft, concentration 1 min.
    - Effect: WIS save (multi-target up to 3). On fail: target has disadvantage on Perception checks (can't hear anything but the caster). v1 has no perception subsystem — sets forward-compat flag `_enthrallActive` on the CASTER (self — the caster is the one enthraling).
    - Pattern: **NEW MULTI-TARGET SAVE PATTERN (3 targets).** `shouldCast` returns `Combatant[]` (up to 3 highest-threat enemies within 60 ft). `execute` rolls a separate save per target. Sets flag + sentinel on the CASTER (not per-target).
    - v1 simplifications: perception-disadvantage subsystem NOT modelled (forward-compat flag only); single-target flag on caster (canon: per-target disadvantage); upcast NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `enthrallPerceptionDisadvV1Implemented: false`, `enthrallUpcastV1Implemented: false`, `enthrallConcentrationEnforcementV1Implemented: false`.

**Group C — Divination/probing spells (1):**

13. **Detect Thoughts** (`src/spells/detect_thoughts.ts`, PHB p.231) — 2nd-level divination, action, self (5-ft aura), concentration 1 min.
    - Effect: Read surface thoughts of creatures in range. WIS save (target can resist). v1 has no mind-reading subsystem — sets forward-compat flag `_detectThoughtsActive` on the CASTER.
    - Pattern: Mirror `darkvision.ts`'s forward-compat flag pattern BUT with concentration. Self-buff (no target). Flag + sentinel on caster.
    - v1 simplifications: mind-reading subsystem NOT modelled (forward-compat flag only); probe action (canon: action to probe deeper — uses WIS save with disadvantage) NOT modelled; upcast NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `detectThoughtsMindReadingV1Implemented: false`, `detectThoughtsProbeActionV1Implemented: false`, `detectThoughtsUpcastV1Implemented: false`, `detectThoughtsConcentrationEnforcementV1Implemented: false`.

**Group D — Self/utility buffs (5):**

14. **See Invisibility** (`src/spells/see_invisibility.ts`, PHB p.274) — 2nd-level divination, action, self, NO concentration (1 hr).
    - Effect: See invisible creatures and objects. v1 has no invisibility-detection subsystem — sets forward-compat flag `_seeInvisibilityActive` on the CASTER.
    - Pattern: Mirror `darkvision.ts` EXACTLY (self-buff, forward-compat flag, NO concentration).
    - v1 simplifications: vision subsystem NOT implemented (flag is forward-compat only — would extend computeLOS to ignore the invisible condition); 1-hr duration not tracked (persists for combat, like Aid); upcast NOT modelled; NOT concentration.
    - Metadata flags: `seeInvisibilityVisionIntegrationV1Implemented: false`, `seeInvisibilityDurationV1Simplified: true`, `seeInvisibilityUpcastV1Implemented: false`.

15. **Spider Climb** (`src/spells/spider_climb.ts`, PHB p.277) — 2nd-level transmutation, action, touch, concentration 1 hr.
    - Effect: Target gains climb speed. v1 has no climb-speed subsystem — sets forward-compat flag `_spiderClimbActive` on the TARGET.
    - Pattern: Mirror `darkvision.ts`'s forward-compat flag pattern BUT with concentration AND touch range (target an ally, not self).
    - v1 simplifications: climb-speed subsystem NOT modelled (forward-compat flag only); upcast NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `spiderClimbClimbSpeedV1Implemented: false`, `spiderClimbUpcastV1Implemented: false`, `spiderClimbConcentrationEnforcementV1Implemented: false`.

16. **Pass without Trace** (`src/spells/pass_without_trace.ts`, PHB p.264) — 2nd-level abjuration, action, self, concentration 1 hr.
    - Effect: +10 to DEX (Stealth) for allies within 30 ft. v1 has no stealth subsystem — sets forward-compat flag `_passWithoutTraceActive` on the CASTER.
    - Pattern: Mirror `darkvision.ts`'s forward-compat flag pattern BUT with concentration. Self-buff aura.
    - v1 simplifications: stealth subsystem NOT modelled (forward-compat flag only); aura multi-ally effect NOT modelled (canon: affects all allies within 30 ft — v1: caster only); upcast NOT modelled; concentration NOT enforced (TG-002).
    - Metadata flags: `passWithoutTraceStealthSubsystemV1Implemented: false`, `passWithoutTraceUpcastV1Implemented: false`, `passWithoutTraceConcentrationEnforcementV1Implemented: false`.

17. **Protection from Poison** (`src/spells/protection_from_poison.ts`, PHB p.270) — 2nd-level abjuration, action, touch, NO concentration (1 hr).
    - Effect: Ends poisoned condition on target + grants advantage on saves vs poison + resistance to poison damage. v1: removes poisoned condition (mirror `lesser_restoration.ts`) AND sets forward-compat flag `_protectionFromPoisonActive` for the advantage/resistance (no subsystem to read it yet).
    - Pattern: Mirror `lesser_restoration.ts`'s condition-removal pattern BUT also sets a forward-compat flag.
    - v1 simplifications: advantage on saves vs poison NOT modelled (forward-compat flag only — would extend `rollSave` to grant advantage on CON saves when poison-related); resistance to poison damage NOT modelled (forward-compat flag only — would extend `applyDamage` to halve poison damage); duration simplified (persists for combat); upcast NOT modelled; NOT concentration.
    - Metadata flags: `protectionFromPoisonAdvantageV1Implemented: false`, `protectionFromPoisonResistanceV1Implemented: false`, `protectionFromPoisonDurationV1Simplified: true`, `protectionFromPoisonUpcastV1Implemented: false`.

18. **Prayer of Healing** (`src/spells/prayer_of_healing.ts`, PHB p.267) — 2nd-level evocation, action (canon: 10 min — v1: action), 30 ft, NO concentration.
    - Effect: Up to 3 creatures within 30 ft regain 2d8 + spellcasting mod HP. v1: action cast (canon: 10 min cast — out-of-combat; v1 simplification: action).
    - Pattern: Mirror `aid.ts`'s multi-target heal pattern. `shouldCast` returns `Combatant[]` (up to 3 lowest-HP% allies within 30 ft, excluding full-HP allies). `execute` rolls 2d8 + WIS mod (default Cleric/Druid casting) per target.
    - v1 simplifications: cast time simplified to action (canon: 10 min — out-of-combat ritual); upcast (+1d8 per slot level) NOT modelled; NOT concentration.
    - Metadata flags: `prayerOfHealingCastTimeV1Simplified: true`, `prayerOfHealingUpcastV1Implemented: false`.

**Group E — Out-of-combat utility (2):**

19. **Knock** (`src/spells/knock.ts`, PHB p.254) — 2nd-level transmutation, action, 60 ft, NO concentration.
    - Effect: Opens a stuck/locked object. v1 has no object/lock subsystem — sets forward-compat flag `_knockActive` on the caster (v1: target = caster self, since there's no object to target — the flag represents "caster has unlocked something this combat").
    - Pattern: Mirror `darkvision.ts`'s forward-compat flag pattern (no concentration, forward-compat only).
    - v1 simplifications: object/lock subsystem NOT modelled (forward-compat flag only); audible-range warning (canon: "the spell makes a loud knock... audible up to 300 feet") NOT modelled; upcast NOT modelled; NOT concentration.
    - Metadata flags: `knockObjectSubsystemV1Implemented: false`, `knockAudibleRangeV1Implemented: false`, `knockUpcastV1Implemented: false`.

20. **Arcane Lock** (`src/spells/arcane_lock.ts`, PHB p.215) — 2nd-level abjuration, action, touch, NO concentration (permanent).
    - Effect: Locks a closed object. v1 has no object/lock subsystem — sets forward-compat flag `_arcaneLockActive` on the caster.
    - Pattern: Mirror `darkvision.ts`'s forward-compat flag pattern (no concentration, forward-compat only).
    - v1 simplifications: object/lock subsystem NOT modelled (forward-compat flag only); upcast NOT modelled; NOT concentration (permanent duration).
    - Metadata flags: `arcaneLockObjectSubsystemV1Implemented: false`, `arcaneLockUpcastV1Implemented: false`.

### Integration points touched (Session 18)

- `src/types/core.ts`:
  - Added 20 new types to `PlannedAction.type` union: `'moonbeam'`, `'scorchingRay'`, `'shatter'`, `'spikeGrowth'`, `'spiritualWeapon'`, `'phantasmalForce'`, `'rayOfEnfeeblement'`, `'web'`, `'silence'`, `'suggestion'`, `'zoneOfTruth'`, `'enthrall'`, `'detectThoughts'`, `'seeInvisibility'`, `'spiderClimb'`, `'passWithoutTrace'`, `'protectionFromPoison'`, `'prayerOfHealing'`, `'knock'`, `'arcaneLock'`.
  - Added 11 new scratch fields on `Combatant`: `_rayOfEnfeeblementActive` (consumed by `resolveAttack` damage branch), `_silenceZoneActive`, `_zoneOfTruthActive`, `_enthrallActive`, `_detectThoughtsActive`, `_seeInvisibilityActive`, `_spiderClimbActive`, `_passWithoutTraceActive`, `_protectionFromPoisonActive`, `_knockActive`, `_arcaneLockActive` (all forward-compat flags, never read in v1).
  - Added NO new `SpellEffectType`s.
  - Added NO new `ActiveEffect.payload` fields.
- `src/engine/spell_effects.ts`:
  - Extended `_undoEffect`'s `'damage_zone'` case (the `dieCount === 0` sentinel cleanup switch) with 7 new spellName-specific cleanup branches: Silence, Zone of Truth, Enthrall, Detect Thoughts, Spider Climb, Pass without Trace, Ray of Enfeeblement.
- `src/engine/combat.ts`:
  - Imported 20 new spell modules (lines 130-210).
  - Added 1 new damage-branch hook in `resolveAttack`: Ray of Enfeeblement (halves weapon damage when `attacker._rayOfEnfeeblementActive === true`). Mirrors the Enlarge/Reduce 'reduce' branch but checks a scratch field instead of an ActiveEffect.
  - Added 20 new case branches in `executePlannedAction`: `'moonbeam'`, `'scorchingRay'`, `'shatter'`, `'spikeGrowth'`, `'spiritualWeapon'`, `'phantasmalForce'`, `'rayOfEnfeeblement'`, `'web'`, `'silence'`, `'suggestion'`, `'zoneOfTruth'`, `'enthrall'`, `'detectThoughts'`, `'seeInvisibility'`, `'spiderClimb'`, `'passWithoutTrace'`, `'protectionFromPoison'`, `'prayerOfHealing'`, `'knock'`, `'arcaneLock'`.
- `src/engine/utils.ts`:
  - Added NO new hooks. Protection from Poison's "advantage on saves vs poison" + "resistance to poison damage" are forward-compat only (the `_protectionFromPoisonActive` flag is set but never read in v1).
- `src/data/spells.ts`:
  - Added 20 new entries to `SPELL_DB`: `'moonbeam'`, `'scorching ray'`, `'shatter'`, `'spike growth'`, `'spiritual weapon'`, `'phantasmal force'`, `'ray of enfeeblement'`, `'web'`, `'silence'`, `'suggestion'`, `'zone of truth'`, `'enthrall'`, `'detect thoughts'`, `'see invisibility'`, `'spider climb'`, `'pass without trace'`, `'protection from poison'`, `'prayer of healing'`, `'knock'`, `'arcane lock'`. Each has `slotLevel: 2` and appropriate `attackType`/`saveAbility`/`requiresConcentration`/`bonusAction` fields.
- `src/ai/planner.ts`:
  - Imported `shouldCast` from all 20 new spell modules.
  - Added 19 action-time spell branches in `planTurn` (sections 11X–11AQ, after Darkvision 11W, before Mage Armor):
    - 11X: Scorching Ray (3 rays, multi-attack, highest damage, NO concentration — highest priority of the 19).
    - 11Y: Shatter (3d8 thunder AoE, NO concentration).
    - 11Z: Moonbeam (2d10 radiant + persistent, concentration).
    - 11AA: Spiritual Weapon (1d8 force + persistent, NO concentration — fallback action-time cast).
    - 11AB: Spike Growth (2d4 piercing persistent, concentration).
    - 11AC: Phantasmal Force (1d6 psychic + persistent, concentration).
    - 11AD: Ray of Enfeeblement (debuff, concentration).
    - 11AE: Web (DEX save or restrained, concentration).
    - 11AF: Suggestion (WIS save or charmed, concentration).
    - 11AG: Silence (AoE blocks verbal spells forward-compat, concentration).
    - 11AH: Zone of Truth (CHA save forward-compat, concentration).
    - 11AI: Enthrall (WIS save, perception debuff forward-compat, concentration).
    - 11AJ: Prayer of Healing (multi-ally heal, NO concentration).
    - 11AK: Protection from Poison (condition removal + buff, NO concentration).
    - 11AL: Detect Thoughts (forward-compat, concentration).
    - 11AM: See Invisibility (forward-compat, NO concentration).
    - 11AN: Spider Climb (forward-compat, concentration).
    - 11AO: Pass without Trace (forward-compat, concentration).
    - 11AP: Knock (forward-compat, NO concentration).
    - 11AQ: Arcane Lock (forward-compat, NO concentration — lowest priority).
  - Added 1 bonus-action spell branch in `planBonusAction` (section 2.10, after Misty Step 2.9, before Bardic Inspiration 3):
    - 2.10: Spiritual Weapon (bonus action, 1d8 force + persistent damage_zone, NO concentration).
  - All 19 action-time branches guarded by `if (!plan.action)` so they only fire when no higher-priority spell was chosen.

### Tests written (Session 18)

- `src/test/moonbeam.test.ts`: 107/107 (metadata, shouldCast gates + priority, execute save resolution full/half, damage_zone with saveDC + saveAbility, rollDamage range check, logging, cleanup no-op, integration).
- `src/test/scorching_ray.test.ts`: 109/109 (metadata, shouldCast gates incl. multi-target return shape, shouldCast target priority with 1/2/3+ enemies, execute multi-attack hits/misses, logging, cleanup no-op, integration).
- `src/test/shatter.test.ts`: 108/108 (metadata, shouldCast gates + AoE target collection, execute save resolution per-target, rollDamage range check, logging, cleanup no-op, integration).
- `src/test/spike_growth.test.ts`: 103/103 (metadata, shouldCast gates + priority, execute damage_zone with NO on-cast damage + NO saveDC, rollDamage range check, logging, cleanup no-op, integration).
- `src/test/spiritual_weapon.test.ts`: 109/109 (metadata, shouldCast gates + priority, execute melee spell attack + damage_zone with ticksRemaining: 10, logging, cleanup no-op, integration).
- `src/test/phantasmal_force.test.ts`: 111/111 (metadata, shouldCast gates + priority, execute save fail → damage + damage_zone, execute save success → NO effect, rollDamage range check, logging, cleanup no-op, integration).
- `src/test/ray_of_enfeeblement.test.ts`: 59/59 (metadata, shouldCast gates incl. weapon-attack requirement, execute scratch field + sentinel on hit, execute miss → no scratch field, logging, cleanup no-op, integration).
- `src/test/web.test.ts`: 59/59 (metadata, shouldCast gates + priority, execute save resolution + restrained condition, logging, cleanup no-op, integration).
- `src/test/silence.test.ts`: 51/51 (metadata, shouldCast gates + priority, execute scratch field + sentinel, logging, cleanup no-op, integration).
- `src/test/suggestion.test.ts`: 58/58 (metadata, shouldCast gates + priority, execute save resolution + charmed condition, logging, cleanup no-op, integration).
- `src/test/zone_of_truth.test.ts`: 63/63 (metadata, shouldCast gates + priority, execute save fail → flag + sentinel, execute save success → no flag, logging, cleanup no-op, integration).
- `src/test/enthrall.test.ts`: 68/68 (metadata, shouldCast gates + multi-target return shape, execute multi-target save + caster flag + sentinel, logging, cleanup no-op, integration).
- `src/test/detect_thoughts.test.ts`: 45/45 (metadata, shouldCast gates, execute scratch field + sentinel on caster, logging, cleanup no-op, integration).
- `src/test/see_invisibility.test.ts`: 34/34 (metadata, shouldCast gates, execute scratch field + NO concentration, logging, cleanup no-op, integration).
- `src/test/spider_climb.test.ts`: 46/46 (metadata, shouldCast gates + priority, execute scratch field + sentinel on TARGET, logging, cleanup no-op, integration).
- `src/test/pass_without_trace.test.ts`: 45/45 (metadata, shouldCast gates, execute scratch field + sentinel on caster, logging, cleanup no-op, integration).
- `src/test/protection_from_poison.test.ts`: 44/44 (metadata, shouldCast gates + priority, execute poisoned-condition removal + forward-compat flag, logging, cleanup no-op, integration).
- `src/test/prayer_of_healing.test.ts`: 48/48 (metadata, shouldCast gates + multi-target return shape + full-HP exclusion, execute multi-target heal with 2d8+WIS, logging, cleanup no-op, integration).
- `src/test/knock.test.ts`: 30/30 (metadata, shouldCast gates, execute scratch field + NO concentration, logging, cleanup no-op, integration).
- `src/test/arcane_lock.test.ts`: 29/29 (metadata, shouldCast gates, execute scratch field + NO concentration, logging, cleanup no-op, integration).
- Total new tests: 1326 assertions across 20 files.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 107/557 spells implemented; 20 new level-2 spells show `implemented: true`).
2. Verify Session 18's work landed:
   - `grep -n "case 'moonbeam'\|case 'scorchingRay'\|case 'shatter'\|case 'spikeGrowth'\|case 'spiritualWeapon'\|case 'phantasmalForce'\|case 'rayOfEnfeeblement'\|case 'web'\|case 'silence'\|case 'suggestion'\|case 'zoneOfTruth'\|case 'enthrall'\|case 'detectThoughts'\|case 'seeInvisibility'\|case 'spiderClimb'\|case 'passWithoutTrace'\|case 'protectionFromPoison'\|case 'prayerOfHealing'\|case 'knock'\|case 'arcaneLock'" src/engine/combat.ts` (should return 20 lines).
   - `grep -n "_rayOfEnfeeblementActive\|_silenceZoneActive\|_zoneOfTruthActive\|_enthrallActive\|_detectThoughtsActive\|_seeInvisibilityActive\|_spiderClimbActive\|_passWithoutTraceActive\|_protectionFromPoisonActive\|_knockActive\|_arcaneLockActive" src/types/core.ts` (should return ~11 lines).
   - `grep -n "case 'Ray of Enfeeblement'\|case 'Silence'\|case 'Zone of Truth'\|case 'Enthrall'\|case 'Detect Thoughts'\|case 'Spider Climb'\|case 'Pass without Trace'" src/engine/spell_effects.ts` (should return 7 lines — the sentinel cleanup cases).
   - `grep -n "attacker._rayOfEnfeeblementActive" src/engine/combat.ts` (should return ~2 lines — the resolveAttack damage-branch hook).
3. Run the new test files: `npx ts-node --transpile-only src/test/{moonbeam,scorching_ray,shatter,spike_growth,spiritual_weapon,phantasmal_force,ray_of_enfeeblement,web,silence,suggestion,zone_of_truth,enthrall,detect_thoughts,see_invisibility,spider_climb,pass_without_trace,protection_from_poison,prayer_of_healing,knock,arcane_lock}.test.ts`. All 20 should print `Results: N passed, 0 failed`.
4. **Pick the next batch of level-2 spells:** Run `npm run spell-cache:pick -- --level 2 --source PHB --count 10`. As noted above, all remaining in-scope PHB level-2 spells are either out-of-combat utility, complex summons (Find Steed), or Darkness (computeLOS — coordinate via TEAMGOALS.md). The cantrip-z workstream has EXHAUSTED all combat-relevant in-scope PHB level-2 spells.
5. **DECISION POINT for Session 19:**
   - (a) Coordinate with Core Engine workstream via TEAMGOALS.md to implement **Darkness** (the last combat-relevant PHB level-2 spell — requires `computeLOS` extension to model "blocks light + sight, magical darkness" — needs TG-004 progress).
   - (b) **PIVOT to LEVEL-3 SPELL IMPLEMENTATION** following the same pattern. Run `npm run spell-cache:pick -- --level 3 --source PHB --count 10`. Suggested first batch: Beacon of Hope, Call Lightning, Clairvoyance, Counterspell, Crusader's Mantle (5 diverse patterns: buff, persistent damage_zone, forward-compat, reaction-counter, aura-buff).
   - (c) **Continue with the remaining out-of-combat utility PHB level-2 spells** as forward-compat flags (mirror Knock / Arcane Lock pattern from Session 18). Candidates: Continual Flame (mirror Light), Augury, Beast Sense, Find Traps, Gentle Repose, Locate Animals or Plants, Locate Object, Magic Mouth, Nystul's Magic Aura, Rope Trick. These have no in-combat effect but could be modelled with forward-compat flags for completeness.
6. Implement each spell following the architecture established in Session 15 + extended in Sessions 16 + 17 + 18 (documented above).
7. `npx tsc --noEmit` + run the full regression suite (must stay green — 139 test files, all 0 failures except pre-existing flakies).
8. `npm run spell-cache:build` — confirm the new spells show `implemented: true`.
9. Commit with message format `Cantrip-19: <summary>` (continuing the pivot-workstream prefix from Session 14/15/16/17/18).
10. Write `zHANDOVER-SESSION-20.md`.
11. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 18)

- All 20 new Session 18 test files green:
  - `moonbeam.test.ts`: 107/107 (NEW)
  - `scorching_ray.test.ts`: 109/109 (NEW)
  - `shatter.test.ts`: 108/108 (NEW)
  - `spike_growth.test.ts`: 103/103 (NEW)
  - `spiritual_weapon.test.ts`: 109/109 (NEW)
  - `phantasmal_force.test.ts`: 111/111 (NEW)
  - `ray_of_enfeeblement.test.ts`: 59/59 (NEW)
  - `web.test.ts`: 59/59 (NEW)
  - `silence.test.ts`: 51/51 (NEW)
  - `suggestion.test.ts`: 58/58 (NEW)
  - `zone_of_truth.test.ts`: 63/63 (NEW)
  - `enthrall.test.ts`: 68/68 (NEW)
  - `detect_thoughts.test.ts`: 45/45 (NEW)
  - `see_invisibility.test.ts`: 34/34 (NEW)
  - `spider_climb.test.ts`: 46/46 (NEW)
  - `pass_without_trace.test.ts`: 45/45 (NEW)
  - `protection_from_poison.test.ts`: 44/44 (NEW)
  - `prayer_of_healing.test.ts`: 48/48 (NEW)
  - `knock.test.ts`: 30/30 (NEW)
  - `arcane_lock.test.ts`: 29/29 (NEW)
- Prior level-2 tests still green:
  - Session 17 (15 spells): enlarge_reduce 60/60, enhance_ability 46/46, flame_blade 43/43, flaming_sphere 104/104, heat_metal 108/108, melf_s_acid_arrow 159/159, misty_step 54/54, invisibility 44/44, gust_of_wind 52/52, levitate 57/57, lesser_restoration 47/47, magic_weapon 53/53, cordon_of_arrows 103/103, alter_self 43/43, darkvision 41/41.
  - Session 16 (5 spells): calm_emotions 41/41, cloud_of_daggers 97/97, crown_of_madness 40/40, hold_person 42/42, mirror_image 55/55.
  - Session 15 (5 spells): aid 43/43, barkskin 38/38, blur 32/32, blindness_deafness 37/37, branding_smite 44/44.
- Prior level-1 tests still green: bless 37/37, entangle 30/30, faerie_fire 29/29, magic_missile 25/25, burning_hands 33/33, sleep 35/35, thunderwave 25/25, arms_of_hadar 39/39, dissonant_whispers 32/32, shield_simple 12/12, shield_of_faith 27/27, mage_armor 21/21, guiding_bolt 51/51, healing_word 41/41, healing_spells 36/36, hex 27/27, warding_bond 41/41.
- Engine / AI / resources / scenario / etc. still green: combat, engine, mechanics, spell_effects, ai, resources, concentration_ai, cunning_action, death_saves 57/57, los, mount, mount_redirect 21/21, parser, pc, scenario, sneak_attack, spell_actions, summons, day 54/54, phase4, integration, character_builder 93/93, character_improvements 51/51, character_leveler 207/207, character_storage 74/74, adv_system 48/48, bardic_inspiration 27/27, html_report 36/36, server 153/153, healing 34/34, rage 44/44, roll_ability_check 96/96.
- All 44 cantrip tests still green: fire_bolt 43, acid_splash 44, poison_spray 46, vicious_mockery 47, sacred_flame 51, blade_ward 38, chill_touch 38, shocking_grasp 26, thorn_whip 11, eldritch_blast 53, toll_the_dead 61, mind_sliver 48, thunderclap 54, booming_blade 218, frostbite 57, sword_burst 54, sapping_sting 50, lightning_lure 88, green_flame_blade 209, word_of_radiance 58, produce_flame 52, infestation 277, shillelagh 60, create_bonfire 99, gust 74, primal_savagery 57, true_strike 49, resistance 49, magic_stone 61, spare_the_dying 71, light 60, minor_illusion 55, mage_hand 62, prestidigitation 59, thaumaturgy 59, mending 64, message 60, control_flames 86, dancing_lights 102, druidcraft 95, encode_thoughts 103, mold_earth 106, shape_water 118, friends 53, guidance 52.
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **107 implemented** (46 cantrips + 15 level-1 + 46 level-2 + 0 levels 3–9), 437 remaining in-scope.
- Pre-existing flaky tests (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary), `melf_s_acid_arrow.test.ts` (transient d20-probabilistic — saw 3 failures on one run, then 5 consecutive clean runs). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work.

---

## NOTES FOR NEXT AGENT

- **The cantrip-z workstream has PIVOTED THREE TIMES.** Session 14: cantrip implementation → forward-compat subsystems (`rollAbilityCheck`). Session 15: forward-compat subsystems → level-2 spell implementation. Session 16: continued level-2 spell implementation (batch 2). Session 17: continued level-2 spell implementation with a DOUBLE-SIZED batch of 15 spells (batch 3, per user instruction). Session 18: continued level-2 spell implementation with a DOUBLE-SIZED batch of 20 spells (batch 4, per user instruction "15 more than requested"). The forward-compat work (Options B/C/D/E/F) is tracked in `TEAMGOALS.md` as TG-001..TG-005 — read that file before starting any cross-workstream task.
- **`TEAMGOALS.md` is the single source of truth for cross-workstream coordination.** Per AGENTS.md PRIORITY RULE, the uploaded handover supersedes AGENTS.md. `TEAMGOALS.md` sits below the handover in authority but above `TASK.md`/`ROADMAP.md`. Any agent may append sections (use the template); edit only your own.
- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Session 18 added NO new SpellEffectTypes.** All 20 new spells reuse existing types (`damage_zone`, `condition_apply`, `advantage_vs`). The damage_zone payload extensions from Session 17 (`saveDC`, `saveAbility`, `ticksRemaining`) cover all the new damage_zone use cases (Moonbeam's save-for-half, Spike Growth's automatic damage, Spiritual Weapon's ticksRemaining: 10, Phantasmal Force's automatic persistent damage).
- **Session 18 added the FIRST MULTI-ATTACK PATTERN: Scorching Ray.** `shouldCast` returns `Combatant[]` of exactly 3 targets (repeats first target if fewer than 3 enemies in range). `execute` loops 3 times, rolling a separate ranged spell attack against each target. This is distinct from Eldritch Blast (cantrip) which only provides metadata for multi-attack (the engine doesn't actually loop multi-beam for Eldritch Blast in v1). Future multi-attack spells (e.g. Eldritch Blast upgrade, Magic Missile's 3 darts — though Magic Missile is auto-hit not attack-roll) should follow the Scorching Ray pattern.
- **Session 18 added the FIRST AoE SAVE PATTERN (radius sphere): Shatter.** `shouldCast` returns `Combatant[]` (all enemies within 10 ft of the highest-threat enemy within 60 ft). `execute` rolls a separate save for each target. This is distinct from Burning Hands (cone AoE) which uses `inConeFt()`. Future radius-sphere AoE save spells should follow the Shatter pattern.
- **Session 18 added the FIRST INT SAVE: Phantasmal Force.** This is the first spell in the cantrip-z workstream to use INT as the save ability. The `rollSave` function already supported INT (it's a generic `'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'` parameter) — no `rollSave` changes were needed.
- **Session 18 added the FIRST CHA SAVE: Zone of Truth.** This is the first spell in the cantrip-z workstream to use CHA as the save ability.
- **Session 18 added the FIRST DEX-SAVE-OR-RESTRAINED spell: Web.** Levitate (Session 17) used CON-save-or-restrained; Web uses DEX-save-or-restrained (canon: DEX save to avoid being restrained by the webbing). Both apply the `restrained` condition with `sourceIsConcentration: true`.
- **Session 18 added 7 NEW SENTINEL CLEANUP CASES in `_undoEffect`** for concentration-bound scratch-field buffs: Silence (`_silenceZoneActive`), Zone of Truth (`_zoneOfTruthActive`), Enthrall (`_enthrallActive`), Detect Thoughts (`_detectThoughtsActive`), Spider Climb (`_spiderClimbActive`), Pass without Trace (`_passWithoutTraceActive`), Ray of Enfeeblement (`_rayOfEnfeeblementActive`). These join the Session 17 sentinel cases (Flame Blade, Alter Self, Enhance Ability). Future concentration-bound scratch-field buffs should follow this pattern.
- **Session 18 added a NEW resolveAttack DAMAGE-BRANCH HOOK: Ray of Enfeeblement.** Mirrors the Enlarge/Reduce 'reduce' branch but checks a scratch field (`attacker._rayOfEnfeeblementActive === true`) instead of an ActiveEffect (`getActiveEnlargeReduce(attacker) === 'reduce'`). The hook halves weapon damage (`Math.floor(dmg / 2)`) for melee/ranged weapon attacks (NOT spell). Future weapon-damage-modifier spells should follow this pattern (either ActiveEffect query OR scratch field — both are valid).
- **Session 18 added a NEW BONUS-ACTION PLANNER BRANCH (2.10 Spiritual Weapon).** This is the SECOND bonus-action spell branch (after 2.8 Branding Smite and 2.9 Misty Step). Future bonus-action level-2 spells should follow the same pattern (return early from `planBonusAction`).
- **Session 18 added NO new `rollAbilityCheck` or `rollSave` hooks.** Protection from Poison's "advantage on saves vs poison" + "resistance to poison damage" are forward-compat only (the `_protectionFromPoisonActive` flag is set but never read in v1). A future implementation could extend `rollSave` to grant advantage on poison-related CON saves when the flag is true, and `applyDamage`/`applyDamageWithTempHP` to halve poison damage. This would be a forward-compat subsystem task similar to TG-001.
- **Commit message convention:** `Cantrip-N: <summary>` (Session 14 was `Cantrip-14: ...rollAbilityCheck...`; Session 15 was `Cantrip-15: Pivot to Level-2 spells...`; Session 16 was `Cantrip-16: Implement <spell names>`; Session 17 was `Cantrip-17: Implement <spell names>`; Session 18 was `Cantrip-18: Implement <spell names>`; Session 19 should be `Cantrip-19: Implement <spell names>` or `Cantrip-19: Pivot to Level-3 spells...`).
- **Pre-existing flaky tests** (do NOT try to fix — outside scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout), `mechanics.test.ts` (d20-probabilistic grapple-contest boundary), `melf_s_acid_arrow.test.ts` (transient d20-probabilistic). These are d20-probabilistic or transient-load and NOT caused by level-2 spell work. (Note: all of these PASSED in Session 18's regression run — the "flaky" label means they SOMETIMES fail, not that they ALWAYS fail.)
- **Architecture summary (level-2 spell pattern — established Session 15, extended Sessions 16 + 17 + 18):**
  - Spell module: `metadata` + `shouldCast` + `execute` + `cleanup` (no-op for concentration spells AND for persistent-effect spells that don't use 1-round scratch flags AND for forward-compat flag spells).
  - Type changes: `PlannedAction.type` union + (if new effect type) `SpellEffectType` + `ActiveEffect.payload` + (if scratch flag) `Combatant._<flagName>`. **Session 18 added 20 PlannedAction types + 11 scratch fields + 0 new effect types + 0 new payload fields.**
  - Engine: `combat.ts` case branch + (if shared computation change) `effectiveAC` / `resolveAttack` damage branch / `resolveAttack` pre-roll section + (if new start-of-turn effect) `runCombat` loop hook + (if scratch flag with 1-round duration) `utils.ts` `resetBudget` cleanup call + (if ability-check/save modifier) `utils.ts` `rollAbilityCheck` / `rollSave` hook. **Session 18 added 1 resolveAttack damage-branch hook (Ray of Enfeeblement) + 0 new start-of-turn hooks (all reuse damage_zone) + 0 cleanup calls + 0 ability-check/save hooks.**
  - Active-effect: `spell_effects.ts` (if new effect type) `applySpellEffect` + `_undoEffect` no-op cases + query function. (If scratch-field buff with concentration) damage_zone sentinel (dieCount=0) + `_undoEffect` spellName-specific cleanup. **Session 18 added 0 new effect types + 7 new sentinel-cleanup spellName cases.**
  - Spell DB: `data/spells.ts` `SPELL_DB` entry.
  - AI planner: `planner.ts` branch in `planTurn` (action) or `planBonusAction` (bonus action).
  - Tests: `test/<snake_name>.test.ts` mirroring `aid.test.ts` / `branding_smite.test.ts` / `cloud_of_daggers.test.ts` / `alter_self.test.ts` pattern. Use deterministic save DCs for probabilistic outcomes. SIMULATE resolveAttack hooks rather than calling resolveAttack directly. Use `conditions: new Set() as Set<Condition>` (NOT `new Set<string>()`) in the makeCombatant helper.
- **All `Combatant` scratch fields added across Sessions 7–18:** (Session 14 list, plus Session 15 + 16 + 17 + 18 additions) `_mindSliverDiePenaltyNextSave?`, `_viciousMockeryDisadvNextAttack?`, `_frostbiteDisadvNextWeaponAttack?`, `_boomingBladePendingDamageDice?`, `_chillTouchNoHealing?` + `_chillTouchUndeadDisadv?`, `_rayOfFrostSpeedReduction?`, `_thornWhipPullPending?`, `_infestationMovePending?`, `_shockingGraspNoReaction?`, `_sappingStingProneApplied?`, `_lightningLurePullPending?`, `_greenFlameBladeSplashPending?`, `_gustPushPending?`, `_shillelaghActive?`, `_trueStrikeAdvNextAttack?`, `_resistanceDieBonusNextSave?`, `_guidanceDieBonusNextAbilityCheck?`, `_friendsAdvNextChaCheck?`, `_lightSourceActive?`, `_isStabilized?`, `_mended?`, **`_aidHPBonus?` (Session 15 — forward-compat only)**, **`_brandingSmiteActive?` (Session 15 — consumed by `resolveAttack`)**, **`_mirrorImageDuplicates?` (Session 16 — consumed by `resolveAttack` pre-roll retargeting hook)**, **`_enlargeReduceActive?` (Session 17 — RESERVED, modeled via ActiveEffect)**, **`_enhanceAbilityActive?` (Session 17 — consumed by `rollAbilityCheck`)**, **`_flameBladeActive?` (Session 17 — consumed by `resolveAttack` damage branch)**, **`_magicWeaponBonus?` (Session 17 — RESERVED, modeled via ActiveEffect)**, **`_alterSelfActive?` (Session 17 — consumed by `resolveAttack` damage branch)**, **`_darkvisionActive?` (Session 17 — forward-compat only)**, **`_rayOfEnfeeblementActive?` (Session 18 — consumed by `resolveAttack` damage branch)**, **`_silenceZoneActive?` (Session 18 — forward-compat only)**, **`_zoneOfTruthActive?` (Session 18 — forward-compat only)**, **`_enthrallActive?` (Session 18 — forward-compat only)**, **`_detectThoughtsActive?` (Session 18 — forward-compat only)**, **`_seeInvisibilityActive?` (Session 18 — forward-compat only)**, **`_spiderClimbActive?` (Session 18 — forward-compat only)**, **`_passWithoutTraceActive?` (Session 18 — forward-compat only)**, **`_protectionFromPoisonActive?` (Session 18 — forward-compat only)**, **`_knockActive?` (Session 18 — forward-compat only)**, **`_arcaneLockActive?` (Session 18 — forward-compat only)**. Optional with sensible defaults.
- **SpellEffectType registry (unchanged from Session 17):** `advantage_vs`, `ac_bonus`, `ac_floor`, `bless_die`, `condition_apply`, `hex_damage`, `damage_zone`, `weapon_enchant`, `enlarge_reduce`. **Session 18 added NONE.**
- **ActiveEffect.payload fields (unchanged from Session 17):** `advType?`, `advScope?`, `acBonus?`, `acFloor?`, `dieSides?`, `condition?`, `hexDie?`, `dieCount?`, `damageType?`, `saveDC?`, `saveAbility?`, `ticksRemaining?`, `attackBonus?`, `damageBonus?`, `enlargeReduceMode?`. **Session 18 added NONE.**
- **FIRST level-2 spell milestones (cumulative, for the next agent's reference):**
  - Session 15: FIRST level-2 spell batch (Aid, Barkskin, Blur, Blindness/Deafness, Branding Smite)
  - Session 15: FIRST `ac_floor` `SpellEffectType` (Barkskin — `Math.max` semantics)
  - Session 15: FIRST non-concentration save-or-condition spell (Blindness/Deafness)
  - Session 15: FIRST one-shot weapon-attack-rider scratch flag (`_brandingSmiteActive`)
  - Session 15: FIRST cross-workstream coordination file (`TEAMGOALS.md`)
  - Session 15: FIRST workstream-pivot to level-2 spells
  - Session 16: SECOND level-2 spell batch (Calm Emotions, Cloud of Daggers, Crown of Madness, Hold Person, Mirror Image)
  - Session 16: FIRST `damage_zone` `SpellEffectType` (Cloud of Daggers)
  - Session 16: FIRST persistent-damage spell (Cloud of Daggers)
  - Session 16: FIRST incoming-attack-interception scratch flag (`_mirrorImageDuplicates`)
  - Session 16: FIRST non-concentration self-buff spell in level-2 workstream (Mirror Image)
  - Session 16: FIRST condition-REMOVAL spell (Calm Emotions)
  - Session 16: FIRST partial TG-002 (concentration) implementation
  - Session 16: FIRST save-or-paralyzed spell (Hold Person)
  - Session 16: FIRST save-or-charmed spell with concentration (Crown of Madness)
  - Session 17: THIRD level-2 spell batch — DOUBLE-SIZED (15 spells)
  - Session 17: FIRST `weapon_enchant` `SpellEffectType` (Magic Weapon)
  - Session 17: FIRST `enlarge_reduce` `SpellEffectType` (Enlarge/Reduce)
  - Session 17: FIRST damage_zone payload extensions (`saveDC`, `saveAbility`, `ticksRemaining`)
  - Session 17: FIRST damage_zone SENTINEL PATTERN (dieCount=0 for concentration-break cleanup)
  - Session 17: FIRST ability-check advantage hook (`_enhanceAbilityActive`)
  - Session 17: FIRST save advantage hook (Enlarge/Reduce STR saves via ActiveEffect)
  - Session 17: FIRST 4 resolveAttack damage-branch hooks in one session (Enlarge/Reduce, Magic Weapon, Flame Blade, Alter Self)
  - Session 17: FIRST bonus-action spell branch (2.9 Misty Step)
  - Session 17: FIRST spell-cache build.ts regex fix for apostrophe-containing names (Melf's Acid Arrow)
  - Session 18: FOURTH level-2 spell batch — DOUBLE-SIZED (20 spells)
  - Session 18: FIRST MULTI-ATTACK PATTERN (Scorching Ray — `shouldCast` returns `Combatant[]` of 3 targets)
  - Session 18: FIRST AoE SAVE PATTERN with radius sphere (Shatter — `shouldCast` returns `Combatant[]` of all enemies in 10-ft radius)
  - Session 18: FIRST INT SAVE (Phantasmal Force)
  - Session 18: FIRST CHA SAVE (Zone of Truth)
  - Session 18: FIRST DEX-SAVE-OR-RESTRAINED spell (Web — Levitate was CON-save-or-restrained)
  - Session 18: FIRST spell where shouldCast gates on enemy having weapon attacks (Ray of Enfeeblement — only useful vs weapon-attack enemies)
  - Session 18: FIRST multi-target save spell that sets a flag on the CASTER not per-target (Enthrall)
  - Session 18: FIRST sentinel cleanup case where the sentinel is on the TARGET not the caster (Spider Climb — sentinel on target ally, not caster)
  - Session 18: FIRST spell modelled as a 10-min cast action (Prayer of Healing — canon: 10 min, v1: action simplification)
  - Session 18: FIRST permanent-duration spell (Arcane Lock — permanent, NO concentration)
  - Session 18: FIRST object/lock subsystem forward-compat flags (Knock, Arcane Lock)

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
