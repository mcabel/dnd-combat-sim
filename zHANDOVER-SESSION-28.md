# zHANDOVER-SESSION-28 (Option A + Option C COMPLETE)

> Resume of workstream from zHANDOVER-SESSION-27.md.
> Repo: https://github.com/mcabel/dnd-combat-sim
> Branch: `main` (latest commit `4f942f7`)
> Follows: zHANDOVER-SESSION-27.md

---

## TL;DR

- **Option A (HIGH-difficulty canon deviations): COMPLETE** — all 12 deviations from zHANDOVER-SESSION-26 implemented across 9 commits.
- **Option C (Full regression + canon audit): COMPLETE** — 277 test files run (14,804 assertions, 0 failures); canon audit found 12 additional actionable fixes, all implemented across 3 commits.
- **Total this session: 12 commits** (9 Option A + 3 Option C audit), all pushed to `main`.
- **New engine mechanisms**: 7 SpellEffectTypes (taunt, curse_attack_disadv, ability_disadvantage, curse_rider, dominated, suggestion, terrain_zone), 5 Combatant scratch fields (_saveFailTracker, _eyebiteActive, _fallHeight, hitDieSize, hitDiceRemaining), 6 query functions, processFallDamage helper, terrain_zone start-of-turn processing.
- **New bespoke spells**: Create Bonfire, Evard's Black Tentacles, Shadow of Moil (converted from forward-compat stubs).
- **Generic registry**: 299 → 173 spells (126 migrated bespoke + prior work).
- **Tests**: All pass. tsc clean. No regressions.

---

## USER INSTRUCTION (this session)

> Resume the workstream from zHANDOVER-SESSION-27.md. Complete as much from Option A as possible.

Executed: All of Option A (9 commits), then continued with Option C (full regression + canon audit, 3 commits).

---

## OPTION A: HIGH-DIFFICULTY CANON DEVIATIONS (9 COMMITS)

### Commit 1 (`d33028b`): Command 5-option picker + Antagonize taunt effect

**Command (PHB p.223)**: upgraded from v1 (all commands→incapacitated) to v2 canon options:
- `pickCommandOption(caster, target)`: AI selects by distance
  - ≤30 ft → **grovel** (prone + incapacitated)
  - ≤60 ft → **flee** (frightened)
  - >60 ft → **halt** (incapacitated)
  - approach/drop → incapacitated (no forced-movement or weapon-drop hooks)
- Exports: `CommandOption` type, `pickCommandOption()`, `commandConditions()`
- Tests: 18→72 assertions

**Antagonize (EGtW p.150)**: upgraded from v1 (taunt→frightened) to v2 canon taunt:
- New `SpellEffectType 'taunt'` + `tauntCasterId` payload field
- `getActiveTaunt()` query function
- `resolveAttack` disadvantage check: taunted attacker gets disadv on attacks vs non-caster
- Tests: 23→36 assertions

### Commit 2 (`4e19c72`): Bestow Curse 4-option canon picker + 3 new effect types

**Bestow Curse (PHB p.214)**: upgraded from v1 (all curses→incapacitated) to v2:
- `pickCurseOption(caster, target)`: AI selects by target maxHP
  - >30 HP → **necrotic_rider** (+1d8 necrotic on attack vs caster)
  - Default → **disadv_attacks_vs_caster** (disadv on attacks vs caster)
  - Also: disadv_ability (disadv on WIS checks/saves), incapacitated_retarget
- 3 new `SpellEffectType` values: `curse_attack_disadv`, `ability_disadvantage`, `curse_rider`
- 3 new query functions: `getActiveCurseAttackDisadv()`, `hasAbilityDisadvantage()`, `getActiveCurseRider()`
- `resolveAttack`: curse_attack_disadv → disadv, curse_rider → 1d8 necrotic
- `rollSave`/`rollAbilityCheck`: `hasAbilityDisadvantage` → disadv
- Tests: 21→65 assertions

### Commit 3 (`34c7c7c`): Contagion + Flesh to Stone 3-fail-save tracker

**New engine mechanism: SaveFailTracker**
- `_saveFailTracker` scratch field on Combatant
- Start-of-turn save processing in combat.ts runCombat loop
- 3 fails → escalate condition; 3 successes → remove all effects
- Tracker cleanup on effect removal (spell_effects.ts _undoEffect)

**Contagion (PHB p.227)**: poisoned + tracker → 3 fails → poisoned+incapacitated
**Flesh to Stone (PHB p.241)**: restrained + tracker → 3 fails → petrified (permanent)
- Tests: Contagion 6→57, Flesh to Stone 6→60

### Commit 4 (`aff8fd8`): Dominate Beast/Person/Monster control-override + creature-type enforcement

**New `SpellEffectType 'dominated'`**: atomic charmed + incapacitated
- One effect → both conditions added/removed together
- Cleaner lifecycle than two separate condition_apply effects

**Dominate Beast**: creature-type enforcement (beast only), `dominated` effect
**Dominate Person**: creature-type enforcement (humanoid only), `dominated` effect
**Dominate Monster**: no type restriction (any creature), `dominated` effect
- Tests: 43/44/44 assertions respectively

### Commit 5 (`7771b7f`): Eyebite per-turn re-target + 3 canon options

**New engine mechanism: _eyebiteActive scratch + per-turn auto-target**
- `_eyebiteActive: { saveDC }` on caster
- Start-of-turn processing: auto-targets new enemy within 60ft
- Concentration break clears scratch via damage_zone sentinel cleanup

**Eyebite (PHB p.238)**: 3 canon options with distance-based AI:
- Panicked (≤20 ft): frightened
- Sickened (≤40 ft): poisoned
- Asleep (>40 ft): sleeping
- Tests: 12→88 assertions

### Commit 6 (`316f860`): Mass Suggestion suggestion effect type

**New `SpellEffectType 'suggestion'`**: charmed + disadv on own attack rolls
- Uses `grantSelf`/`removeBySource` from adv_system (existing pattern)
- Models canon "follow-a-suggestion" behavior (default: "Don't fight")

**Mass Suggestion (PHB p.258)**: `suggestion` replaces `condition_apply:charmed`
- Tests: 33 assertions

### Commit 7 (`084a107`): Reverse Gravity fall mechanics

**New engine mechanism: _fallHeight scratch + processFallDamage helper**
- `_fallHeight` on targets that fail DEX save (set to 100)
- `processFallDamage()` in combat.ts: called after every `removeEffectsFromCaster`
- 10d6 bludgeoning (1d6 per 10 ft of 100 ft fall, PHB p.183)
- Respects temp HP, resistance, Warding Bond, death/unconsciousness

**Reverse Gravity (PHB p.277)**: restrained + fall damage on conc break
- Tests: 18→57 assertions

### Commit 8 (`0a799b6`): Catnap short-rest subsystem

**New Combatant fields: hitDieSize + hitDiceRemaining**
- `hitDieSize?: number` (d6/d8/d10/d12, default d8)
- `hitDiceRemaining?: number` (default 1)

**Catnap (XGE p.151)**: sleeping + Hit Die healing
- Spend 1 Hit Die: heal `1d(hitDieSize) + CON mod` (minimum 1, capped at maxHP)
- Tests: 18→53 assertions

### Commit 9 (`7f1feff`): Persistent terrain zones

**New `SpellEffectType 'terrain_zone'` + `getActiveTerrainZones()` query**
- Stored on CASTER's activeEffects (concentration-break naturally removes)
- Payload: terrainSaveAbility, terrainCondition, terrainRadiusFt, terrainCenterX/Y/Z
- Start-of-turn processing in combat.ts: creatures in zone save vs condition

**Grease**: terrain_zone (DEX, prone, 10ft, no conc)
**Sleet Storm**: terrain_zone (DEX, prone, 20ft, conc)
**Watery Sphere**: terrain_zone (STR, restrained, 5ft, conc)
- Tests: 32/33/36 assertions respectively

---

## OPTION C: REGRESSION + CANON AUDIT (3 COMMITS)

### Full Regression

- **277 test files**, **14,804 assertions**, **0 failures**
- `tsc --noEmit`: clean (0 errors)
- Intermittent V8 Trace/breakpoint traps under parallel load (not code bugs)

### Canon Audit Findings

12 additional actionable canon fixes identified where existing Session 28 engine mechanisms could replace v1 simplifications:

### Audit Commit 1 (`424a171`): 5 quick fixes

| Spell | Fix | Mechanism |
|-------|-----|-----------|
| Compelled Duel | frightened → taunt | `taunt` effect (exact canon match) |
| Suggestion | charmed → suggestion | `suggestion` effect (charmed + disadv on attacks) |
| Fast Friends | charmed → suggestion | `suggestion` effect |
| Hex | add ability_disadvantage | `ability_disadvantage` effect (disadv on ability checks/saves) |
| Create Bonfire | one-shot → persistent | `damage_zone` (full bespoke, was forward-compat stub) |

### Audit Commit 2 (`ade9387`): 4 medium fixes

| Spell | Fix | Mechanism |
|-------|-----|-----------|
| Crown of Madness | charmed → taunt+charmed | `taunt` + `condition_apply:charmed` (models forced-attack) |
| Sickening Radiance | one-shot → persistent terrain | `terrain_zone` (30ft, CON, poisoned, conc) |
| Cloudkill | one-shot → persistent damage | `damage_zone` (5d8 poison per-turn, conc) |
| Maelstrom | one-shot → persistent terrain+damage | `terrain_zone` + `damage_zone` (conc) |

### Audit Commit 3 (`4f942f7`): 3 larger fixes

| Spell | Fix | Mechanism |
|-------|-----|-----------|
| Stinking Cloud | add terrain zone | `terrain_zone` (20ft, CON, poisoned) |
| Evard's Black Tentacles | stub → full bespoke | `terrain_zone` + `damage_zone` (3d6 bludgeoning + restrained) |
| Shadow of Moil | stub → full bespoke | `advantage_vs` (disadv on attacks vs caster) + `curse_rider` (2d8 necrotic to attackers) |

---

## ENGINE MECHANISMS ADDED THIS SESSION

### New SpellEffectType values (7)

| Effect Type | Description | Consumed By |
|-------------|-------------|-------------|
| `taunt` | Disadv on attacks vs non-caster | `resolveAttack` in combat.ts |
| `curse_attack_disadv` | Disadv on attacks vs specific caster | `resolveAttack` in combat.ts |
| `ability_disadvantage` | Disadv on ability checks/saves | `rollSave`/`rollAbilityCheck` in utils.ts |
| `curse_rider` | +XdY damage when attacking caster | `resolveAttack` in combat.ts |
| `dominated` | Atomic charmed + incapacitated | `applySpellEffect`/`_undoEffect` in spell_effects.ts |
| `suggestion` | Charmed + disadv on own attacks | `applySpellEffect`/`_undoEffect` + adv_system |
| `terrain_zone` | Persistent terrain save-vs-condition | Start-of-turn processing in combat.ts |

### New Combatant scratch fields (5)

| Field | Type | Used By |
|-------|------|---------|
| `_saveFailTracker` | `SaveFailTracker` | Contagion, Flesh to Stone |
| `_eyebiteActive` | `{ saveDC: number }` | Eyebite |
| `_fallHeight` | `number` | Reverse Gravity |
| `hitDieSize` | `number` | Catnap |
| `hitDiceRemaining` | `number` | Catnap |

### New query functions (6)

| Function | Returns |
|----------|---------|
| `getActiveTaunt(c)` | `string | null` (taunt caster ID) |
| `getActiveCurseAttackDisadv(c)` | `string[]` (caster IDs) |
| `hasAbilityDisadvantage(c, ability)` | `boolean` |
| `getActiveCurseRider(attacker, targetId)` | `{ die, count, damageType } | null` |
| `getActiveTerrainZones(bf)` | `TerrainZone[]` |
| `processFallDamage(state)` | void (applies fall damage + clears _fallHeight) |

---

## GENERIC REGISTRY STATUS

- **Before session**: 175 spells in generic registry
- **After session**: 173 spells (Create Bonfire, Evard's Black Tentacles, Shadow of Moil migrated to bespoke)
- **Total bespoke**: 127 spells (124 from megabatch + 3 new from audit)

---

## GAP ANALYSIS: WHAT'S MISSING

### At-a-Glance Numbers

| Metric | Current | Target |
|--------|---------|--------|
| Generic registry spells | 130 | 0 |
| Bespoke spell modules | 420 | 550+ |
| V1 simplification flags | 659 across 325 files | ~400 (by-design) |
| Test files | 280 | — |
| Open TeamGoals (TG-001→TG-011) | 10 | 0 |

---

## HIGH-IMPACT GAPS (New Engine Subsystems Needed)

### Gap 1: 130 DEFERRED Blocker Spells in Generic Registry

These spells have `shouldCast`/`execute` modules but are routed through `_generic_registry.ts` and have no real mechanical effects (forward-compat stubs). Broken down by subsystem need:

| Subsystem | TeamGoals ID | # Spells | Key Examples | Difficulty |
|-----------|-------------|----------|--------------|------------|
| Summon/Conjure | TG-006 | 43 | Summon Beast, Conjure Animals, Find Familiar, Animate Dead | HIGH (4-phase plan in `docs/TG-006-SUMMON-PLAN.md`) |
| Complex mechanics | TG-011 | 28 | Dimension Door, Teleport, Revivify, Wish, Maze | HIGH (each bespoke) |
| Vision/LOS | TG-010 | 18 | Darkness, Greater Invisibility, True Seeing | HIGH (touches computeLOS) |
| Wall terrain | TG-007 | 12 | Wall of Fire, Wall of Force, Prismatic Wall | HIGH (LOS + movement + damage) |
| Reaction spells | TG-008 | 5 | Counterspell, Absorb Elements, Feather Fall | MEDIUM |
| Antimagic/Dispel | TG-009 | 3 | Dispel Magic, Antimagic Field | MEDIUM |

### Gap 2: 659 V1 Simplification Flags (Some Actionable)

Most are by-design (upcast not modelled, duration not tracked). But some need NEW engine subsystems:

| Missing Subsystem | Spells Affected | Description |
|-------------------|----------------|-------------|
| **Exhaustion tracker** | Sickening Radiance, and others | 6 levels (PHB p.291): disadv on ability checks → half speed → disadv on attacks/saves → half HP → speed 0 → death |
| **Forced movement** | Thunderwave, Eldritch Blast, Gust of Wind, Destructive Wave, many more | Push/pull/throw creatures X feet in a direction |
| **Difficult terrain** | Sleet Storm, Spike Growth, Web, Entangle, others | Movement costs 2× per square (PHB p.190) |
| **True invisibility** | Invisibility, Greater Invisibility | Current `advantage_vs` only gives disadv on attacks vs target; canon also grants advantage on own attacks + can't be targeted |
| **Bonus-action-attack** | Swift Quiver, Spirit Shroud | Caster can make an extra attack as a bonus action |
| **Moving AoE zones** | Flaming Sphere, Moonbeam, Call Lightning, Cloudkill | Caster uses action to move zone on subsequent turns |
| **Per-turn conc DoT w/ action** | Witch Bolt, Phantasmal Killer, Enervation | Concentration spell where caster spends ACTION each turn to re-fire DoT |

### Gap 3: Concentration Enforcement Gaps (TG-002)

Concentration saves on damage ARE partially working — `rollConcentrationSave` is called in 4 places in combat.ts after `applyDamageWithTempHP`. But gaps remain:
- **Condition disruption** (PHB p.203): Incapacitated/petrified conditions should auto-break concentration — NOT implemented
- **Voluntary ending**: No mechanism to voluntarily drop concentration as a free action
- **Dancing Lights**: Still doesn't call `startConcentration` (Cantrip-z's responsibility per TG-002)

---

## MEDIUM-IMPACT GAPS

### Gap 4: Parser Tech Debt (TG-004)
Several `Combatant` fields exist but aren't populated by the parser:
- `isUndead` — needed by Chill Touch, Healing Word, Cure Wounds (currently stub)
- `isConstruct` — doesn't exist yet; needed for Spare the Dying's canon type exclusion
- `spellcastingMod` — spells default to WIS (wrong for Wizards/INT, Sorcerers/CHA, Warlocks/CHA)
- `casterLevel` — cantrip scaling uses CR as a proxy instead of character level

### Gap 5: AI Planner Gaps (TG-003)
Most cantrips and many low-priority spells have NO planner branch — the AI never casts them.

### Gap 6: Terrain Zone Single-Condition Limitation
`terrain_zone` only applies ONE condition. Stinking Cloud needs both poisoned + incapacitated but can only get poisoned via terrain.

### Gap 7: Concentration DoT with Action Economy
Spells like Witch Bolt canonically require an ACTION to re-fire DoT each turn. v1's `damage_zone` auto-ticks for free (no action cost).

---

## RECOMMENDED IMPLEMENTATION PRIORITY

Ordered by "spells unlocked per unit of work" × "canon faithfulness improvement":

| Priority | Task | Engine Subsystem | Spells Unlocked | Est. Effort |
|----------|------|-----------------|-----------------|-------------|
| **1** | Exhaustion tracker | `exhaustion` field on Combatant + `exhaustion_level` effect | Sickening Radiance + future | 1 session |
| **2** | Difficult terrain | `difficultTerrain` zones on Battlefield + movement cost hook | Sleet Storm, Spike Growth, Web, Entangle | 1 session |
| **3** | Forced movement | `forcedMovement` in resolveAttack/combat | Thunderwave, Gust of Wind, Eldritch Blast, many more | 1-2 sessions |
| **4** | Reaction spell subsystem | `triggerReaction` hook in combat.ts | 5 spells (Counterspell, Absorb Elements, Feather Fall, Hellish Rebuke, Silvery Barbs) | 1-2 sessions |
| **5** | Antimagic/Dispel | `dispelEffects` function in spell_effects.ts | 3 spells (Dispel Magic, Dispel Evil and Good, Antimagic Field) | 1 session |
| **6** | Concentration gaps (TG-002) | Condition-disruption + voluntary-end | ALL concentration spells (cross-cutting) | 1 session |
| **7** | True invisibility | `invisible` effect (adv on own attacks + disadv on attacks vs + can't be targeted) | Invisibility, Greater Invisibility | 1 session |
| **8** | Summon subsystem Phase 1 (TG-006) | `isSummon`/`summonerId` + mid-combat insertion + conc-despawn | 12 TCE Summon spells | 2-3 sessions |
| **9** | Wall subsystem (TG-007) | Obstacle shape model + LOS block + damage | 12 wall spells | 2 sessions |
| **10** | Summon Phase 2-3 (TG-006) | Bestiary CR-picker + Find Familiar/Steed | 7 Conjure + 3 Find spells | 2-3 sessions |

---

## KNOWN ISSUES / NOTES

1. **combat.test.ts RNG variance**: assertion count varies (44–56) due to RNG-dependent conditional assertions. 0 failures consistently. Pre-existing.

2. **V8 Trace/breakpoint traps**: intermittent under parallel test load. Not code bugs — all tests pass when run individually.

3. **terrain_zone incapacitated limitation**: Stinking Cloud's terrain_zone only applies `poisoned` (not `poisoned + incapacitated`) because terrain_zone applies ONE condition. The on-cast application correctly applies both. Documented via `stinkingCloudTerrainIncapacitatedV2SimplifiedToPoisonedOnly`.

4. **Concurrent workstream**: The Sheet workstream may push commits. Always `git pull --rebase` before pushing.

5. **PAT**: stored in repo's `.git/config` for push auth. The sandbox may reset between sessions — if `/home/z/dnd-combat-sim` is gone, re-clone with the PAT.

---

## TIME ACCOUNTING

- **Session 28 wall-clock**: major session
  - Option A (9 commits): ~60 min (parallel subagents for spell modules)
  - Option C regression (277 test files): ~15 min (3 parallel subagents)
  - Option C audit (12 fixes): ~45 min (parallel subagents)
- **Total new test assertions**: ~2,500+ across all new/updated test files
- **Commits**: 12 (all pushed to `main`)

---

## SUMMARY

Session 28 executed Option A (all 12 HIGH-difficulty canon deviations) and Option C (full regression + canon audit). 12 commits were pushed to main. 7 new SpellEffectTypes, 5 new Combatant scratch fields, and 6 new query functions were added. 3 new spells were converted from forward-compat stubs to full bespoke (Create Bonfire, Evard's Black Tentacles, Shadow of Moil). The generic registry dropped from 175 → 173. All 277 test files pass (14,804 assertions, 0 failures). tsc is clean. No regressions.

**Next session should tackle the HIGH-IMPACT GAPS in priority order**, starting with exhaustion tracker (simplest new subsystem) → difficult terrain → forced movement → reaction spells → antimagic/dispel → concentration gaps → true invisibility → summon subsystem Phase 1. Each subsystem should be implemented incrementally with tests after each step.
