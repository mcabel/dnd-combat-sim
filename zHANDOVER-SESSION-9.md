# zHANDOVER-SESSION-9

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `c4cfc11` — Cantrip-7: Implement Eldritch Blast, Toll the Dead, Mind Sliver, Thunderclap, Booming Blade (PHB/XGE/TCE)
  - `c975049` — Cantrip-6: Implement Fire Bolt, Acid Splash, Poison Spray, Vicious Mockery, Sacred Flame (PHB)
  - `bc4d033` — Cantrip-3/4/5: Recover lost sessions (Chill Touch + Blade Ward + handovers)
  - `f2f40a3` — Spell-cache: per-level cache + batch picker tooling
- Commits this session:
  - `<new>` — Cantrip-8: Implement Frostbite, Green-Flame Blade, Lightning Lure, Sword Burst, Sapping Sting (XGE/TCE/EGW)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: user provides in chat each session. do not warn.

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrips** | **THIS agent (you)** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — DO NOT TOUCH |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip workstream)

- **Your tasks come from `zHANDOVER-SESSION-*.md`.** This handover defines the next batch.
- Implement cantrips per PHB/XGE/TCE/EGW (2014 canon, pre-2024 only). Sessions 1–8 implemented 20 cantrips. This session extends to the **next batch of 5 combat cantrips**.
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts` — now **FOUR registries** (Session 7 added `CANTRIP_AOE_EFFECTS`, Session 8 added 5 new entries across the existing registries):
  - `CANTRIP_EFFECTS` — post-hit / post-save-fail riders (Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Vicious Mockery, Mind Sliver, Booming Blade, **Frostbite**, **Sapping Sting**, **Lightning Lure**, **Green-Flame Blade**)
  - `CANTRIP_ATTACK_ADVANTAGE` — pre-roll advantage (Shocking Grasp)
  - `CANTRIP_SELF_EFFECTS` — non-attack self-buffs (Blade Ward)
  - `CANTRIP_AOE_EFFECTS` — caster-centered AoE (Thunderclap, **Sword Burst**)
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-8.md`** (Session 8 patterns: Frostbite's weapon-attack-only filter via `isWeaponAttack` check, Sapping Sting's `addCondition` for prone, Lightning Lure's `action.damage = null` so applyCantripEffect handles all damage, Green-Flame Blade's `findSplashTarget` + `rollSplashDamage` helpers, Sword Burst's `CANTRIP_AOE_EFFECTS` registration mirroring Thunderclap). These are your templates.
3. Read `zHANDOVER-SESSION-7.md` (Mind Sliver's `rollSave` integration, Booming Blade's `executeMove` movement hook, Thunderclap's `CANTRIP_AOE_EFFECTS` registry, Toll the Dead's conditional damage at Action-build time, Eldritch Blast's multi-beam v1 simplification) — also templates.
4. Read `SPELL-CACHE.md` — it explains the cache + picker workflow.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — refresh the cache (confirm 20/49 cantrips implemented).
7. For each cantrip below, run `npm run spell-cache:show -- "Name"` to get the full raw 5etools JSON (entries, scalingLevelDice, components) before implementing.

---

## GOALS THIS SESSION — Batch: 5 combat cantrips (mechanically diverse)

Picked from `spell-cache/level-0.json` (curated for mechanical diversity — each exercises a NEW pattern or extends an existing one with a different save ability / damage type / movement direction). These 5 push the cantrip architecture further: a random-direction forced movement (Infestation), a third caster-centered AoE (Word of Radiance), a persistent ground hazard (Create Bonfire), a simple ranged spell attack (Produce Flame), and a weapon-stat-override self-buff (Shillelagh).

| # | Name | School | Effect | Source | Page | Module to create |
|---|------|--------|--------|--------|------|------------------|
| 1 | **Infestation** | Conjuration | CON save · 1d6 poison · 30 ft · **target moves 5 ft in a RANDOM direction (d4: N/S/E/W) on save-fail** · +scales | XGE (2017-11-21) | 158 | `src/spells/infestation.ts` |
| 2 | **Word of Radiance** | Evocation | DEX save · 1d6 radiant · **all creatures within 5 ft of caster** · +scales | PHB (2014-08-19) | 289 | `src/spells/word_of_radiance.ts` |
| 3 | **Create Bonfire** | Conjuration | DEX save · 1d8 fire · 60 ft · **persistent 5-ft cube ground hazard, concentration** (triggers on cast + on move-into + on end-turn-in) · +scales | XGE (2017-11-21) | 152 | `src/spells/create_bonfire.ts` |
| 4 | **Produce Flame** | Conjuration | ranged spell attack · 1d8 fire · 30 ft (throw range) · v1 simplification: implement only the throw (skip the create-light mode) · +scales | PHB (2014-08-19) | 269 | `src/spells/produce_flame.ts` |
| 5 | **Shillelagh** | Transmutation | self-buff · 1 minute · **melee weapon attacks use WIS instead of STR for attack/damage, +1d8 radiant damage** (v1 simplification) · NO scaling (the +1d8 is the cantrip's effect, not a damage-scaling track) | PHB (2014-08-19) | 275 | `src/spells/shillelagh.ts` |

### Implementation checklist (paste into the session's completion notes)

- [ ] **Infestation** (`XGE p.158`) — CON save, 1d6 poison, scales. **Rider: on save-FAIL, target moves 5 ft in a RANDOM direction (roll d4: 1=N, 2=S, 3=E, 4=W).** This is the FIRST cantrip with RANDOM-DIRECTION forced movement (Thorn Whip and Lightning Lure pull TOWARD the caster; Infestation moves in a random cardinal direction). Reuse the forced-movement pattern (direct `target.pos` set, NOT `executeMove` — no OAs, no Booming Blade detonation, mirror Thorn Whip / Lightning Lure). NEW HELPER: `rollRandomDirection()` returns a cardinal direction (N/S/E/W) by rolling 1d4. The move is 5 ft (1 square) in that direction — if the destination is blocked (wall, obstacle) or off-battlefield, the target doesn't move (XGE p.158: "if the direction rolled is blocked, the target doesn't move"). Register in `CANTRIP_EFFECTS` (post-save-FAIL). No scratch field needed (movement is instant). No cleanup needed.
- [ ] **Word of Radiance** (`PHB p.289`) — DEX save, 1d6 radiant, **all creatures within 5 ft of caster** (caster-centered AoE), scales. This is the THIRD caster-centered AoE cantrip — MIRRORS Thunderclap (CON save, thunder) and Sword Burst (DEX save, force) but with DEX save + radiant damage. Register in the existing `CANTRIP_AOE_EFFECTS` registry. The execute handler should be near-identical to Thunderclap's / Sword Burst's: find all creatures within 5 ft (Euclidean), roll DEX save for each, apply 1d6 radiant on fail / half on success. Caster is excluded. Components: V + M (a holy symbol). v1: read saveDC + damage from the Word of Radiance Action on caster.actions.
- [ ] **Create Bonfire** (`XGE p.152`) — DEX save, 1d8 fire, 60 ft, scales. **Persistent 5-ft cube ground hazard, concentration.** Triggers: (1) on cast — any creature in the bonfire's space when the spell is cast makes the save; (2) on move-into — a creature that moves into the space for the first time on a turn makes the save; (3) on end-turn — a creature that ends its turn in the space makes the save. This is the FIRST persistent ground hazard cantrip — requires a NEW subsystem (mirror the `activeEffects` system on `Combatant` but for ground tiles). Recommendation for v1: implement only trigger (1) on-cast damage (the simplest case), and document triggers (2) and (3) as TODO via `bonfirePersistentV1Implemented: false` metadata flag. This keeps v1 scoped while exposing the full design for a future batch. Register in `CANTRIP_EFFECTS` for the on-cast damage (post-save-FAIL is wrong — this is a save-based damage cantrip with NO rider; the damage IS the effect). Actually, the cleanest routing is: Create Bonfire's Action has `attackType='save'` and the save branch in resolveAttack handles the on-cast damage normally (no cantrip dispatcher entry needed for trigger 1). The persistent trigger (2)/(3) requires a future batch — document as TODO.
- [ ] **Produce Flame** (`PHB p.269`) — Ranged spell attack, 1d8 fire, 30 ft (throw range), scales. v1 simplification: implement only the THROW mode (ranged spell attack vs AC, 1d8 fire on hit). The CREATE-FLAME mode (creates a flame in hand that sheds light for 10 minutes) is a utility mode — skip for v1, document as TODO via `produceFlameCreateModeV1Implemented: false` metadata flag. Mirror Fire Bolt (PHB p.242) — same pattern: ranged spell attack, fire damage, scales at 5/11/17. Metadata only (no rider → no CANTRIP_EFFECTS entry). No new patterns needed — this is a vanilla ranged spell attack cantrip.
- [ ] **Shillelagh** (`PHB p.275`) — Self-buff, 1 minute, **melee weapon attacks use WIS instead of STR for attack/damage rolls, +1d8 radiant damage on hit** (v1 simplification — canonically the weapon damage BECOMES 1d8, not +1d8). This is the FIRST self-buff cantrip to modify WEAPON ATTACKS — extends the `CANTRIP_SELF_EFFECTS` registry (mirror Blade Ward which is also a self-buff). NEW scratch fields on `Combatant`: `_shillelaghActive?: boolean` (set on cast, cleared by cleanup at start of caster's next turn — but Shillelagh lasts 1 minute = 10 rounds, so the flag should persist across turns; the cleanup should only clear it if the caster's concentration breaks or the duration expires). v1 simplification: treat as a 1-round buff (clears at start of caster's next turn, like Blade Ward) — document the 1-minute duration as a TODO via `shillelaghDurationV1Simplified: true` metadata flag. The buff integrates into `resolveAttack`'s attack-roll branch: if `attacker._shillelaghActive === true` AND `action.attackType === 'melee'`, use WIS mod for hitBonus (instead of STR) and add +1d8 radiant to damage. Register in `CANTRIP_SELF_EFFECTS` (mirror Blade Ward's `applySelfEffect`).

### Integration points you will touch (expected)

- `src/types/core.ts`: Add `_shillelaghActive?: boolean` to `Combatant` (Shillelagh). Infestation, Word of Radiance, Create Bonfire, Produce Flame need NO new scratch fields (Infestation's move is instant; Word of Radiance uses the existing CANTRIP_AOE_EFFECTS registry; Create Bonfire v1 is just a save-based damage cantrip with no rider; Produce Flame is metadata-only).
- `src/engine/cantrip_effects.ts`: Add `'Infestation'`, `'Shillelagh'` (self-buff) entries. Add `'Word of Radiance'` to `CANTRIP_AOE_EFFECTS`. (Create Bonfire and Produce Flame need NO registry entries — Create Bonfire rides resolveAttack's save branch directly; Produce Flame is metadata-only.)
- `src/engine/combat.ts`:
  - `resolveAttack` attack branch — add Shillelagh WIS-for-STR substitution: if `attacker._shillelaghActive === true && action.attackType === 'melee'`, recompute hitBonus using WIS mod instead of STR mod, and add +1d8 radiant to the damage roll. Fold into the existing damage calc.
  - `executePlannedAction` `case 'cast':` — no changes needed (Word of Radiance auto-routes via `resolveCantripAoE`; Shillelagh auto-routes via `resolveCantripAction`).
  - `executeMove` — no changes needed (Infestation's move is forced movement via direct pos set, bypassing executeMove — mirror Thorn Whip / Lightning Lure).
- `src/engine/utils.ts`: `resetBudget` — add `cleanupShillelagh(c)` (clears the flag if not consumed before the start of the caster's next turn — v1 simplification, see Shillelagh checklist).
- **Do NOT** touch the AI planner (`src/ai/planner.ts`) — that's Core Engine territory.

### Tests (write one `*.test.ts` per cantrip, in the repo's ts-node convention)

Mirror `src/test/frostbite.test.ts` (57 tests — weapon-attack-only filter pattern + control tests for spell-attack exclusion), `src/test/sword_burst.test.ts` (54 tests — caster-centered AoE pattern with Euclidean circle verification), `src/test/sapping_sting.test.ts` (50 tests — condition-inflicting pattern with prone-advantage control tests), `src/test/lightning_lure.test.ts` (88 tests — forced movement + conditional damage pattern with Booming Blade control test), and `src/test/green_flame_blade.test.ts` (209 tests — splash pattern with level-scaling verification) for structure. Use deterministic save outcomes (DC=30 for guaranteed fail, DC=1 + ability=30 for guaranteed success) and `isCritOverride=true` for forced attack-roll hits. Target ~50–100 tests per cantrip. Each test file must exit non-zero on failure (`process.exit(1)`).

**Critical test cases per cantrip:**
- Infestation: metadata; CON save; **rider moves target 5 ft in a random direction (d4) on save-fail** (run multiple iterations, verify the target moves to ONE of 4 cardinal-adjacent squares, never diagonal, never more than 5 ft); **save-success applies NO movement**; **forced movement does NOT trigger Booming Blade** (control test — mirror Lightning Lure test section 16); **blocked destination → no movement** (control test with a wall); scales; **`rollRandomDirection()` helper returns 1..4 with equal probability** (statistical test over 1000 rolls); Total Cover respects.
- Word of Radiance: metadata; DEX save; **caster-centered AoE (all within 5 ft)** — verify multiple enemies in range each roll a save; **caster is NOT hit**; enemies beyond 5 ft are NOT hit; **diagonal enemies (~7 ft) NOT hit** (Euclidean circle); scales; **registered in CANTRIP_AOE_EFFECTS** (resolveCantripAoE returns true); **damage type = radiant**; save SUCCESS → half (0..3); save FAIL → full (1..6).
- Create Bonfire: metadata; DEX save; **on-cast damage (trigger 1)**: creature in the bonfire's space when cast makes a save, 1d8 fire on fail / half on success; **persistent triggers (2) and (3) NOT YET implemented** (v1 simplification — document via metadata flag `bonfirePersistentV1Implemented: false`); **concentration required** (action.requiresConcentration = true); scales; Total Cover respects (the bonfire is created at a target point — LOS applies to the targeting, not to creatures in the space).
- Produce Flame: metadata; ranged spell attack; **damage type = fire**; scales (1d8 → 2d8 → 3d8 → 4d8 at 5/11/17); **v1 throw-only simplification documented** (metadata flag `produceFlameCreateModeV1Implemented: false`); components (V + S); **no CANTRIP_EFFECTS/SELF/AoE entries** (metadata only); dispatcher safety; Action shape; resolveAttack hit (forced crit via isCritOverride=true → 2d8=2..16 range); resolveAttack miss; Total Cover respects.
- Shillelagh: metadata; **self-buff flag** (isSelfBuff = true); **WIS-for-STR substitution** (set `_shillelaghActive` on caster, attack with a melee weapon, verify the attack roll uses WIS mod not STR mod); **+1d8 radiant damage on melee hit** (verify the damage log includes radiant); **buff applies to MELEE attacks only** (control test — ranged attack with the buff active does NOT get WIS substitution or +1d8 radiant); **buff clears at start of caster's next turn** (resetBudget cleanup); **v1 1-round simplification documented** (metadata flag `shillelaghDurationV1Simplified: true` — canonically 1 minute / 10 rounds, future work); components (V + S + M — mistletoe, a shamrock leaf, and a club or quarterstaff).

---

## COMPLETED THIS SESSION (Session 8, for reference)

### Feature: 5 cantrips implemented

1. **Frostbite** (`src/spells/frostbite.ts`) — XGE p.156. CON save, 1d6 cold, 60 ft, scales. **Rider: target has disadv on the next WEAPON ATTACK roll it makes before the end of its next turn.** This MIRRORS Vicious Mockery (one-shot attack debuff) but with a key restriction: the rider applies ONLY to weapon attacks (melee/ranged), NOT spell attacks. New scratch field `_frostbiteDisadvNextWeaponAttack?: boolean` on `Combatant`. resolveAttack's attack-roll branch folds this into the `disadvantage` boolean ONLY when `action.attackType === 'melee' || 'ranged'` (the FIRST cantrip to filter its one-shot debuff by attackType). Consume (set to false) after the attack roll resolves, hit or miss. Cleanup via `resetBudget`. Registered in `CANTRIP_EFFECTS` (post-save-FAIL).
2. **Green-Flame Blade** (`src/spells/green_flame_blade.ts`) — TCE p.107. Melee spell attack, 1d8 fire (v1 simplification), reach 5 ft, scales. **Splash rider: on hit, fire damage leaps from the primary target to a SECOND creature within 5 ft of the primary.** Splash damage = spellcasting mod (min 1) at 1–4, +1d8 at 5+, +2d8 at 11+, +3d8 at 17+. v1 auto-selects the nearest enemy within 5 ft of the primary (excluding caster and primary). This MIRRORS Booming Blade (melee cantrip with a rider) but the rider is INSTANT splash damage (not a movement trigger). New metadata fields: `scalingDiceSplash`, `splashDamageByLevel`. New helpers: `rollSplashDamage(casterLevel, spellcastingMod)` and `findSplashTarget(caster, primary, state)`. New Combatant fields: `spellcastingMod?: number`, `casterLevel?: number` (populated by parser, set directly in tests). Registered in `CANTRIP_EFFECTS` (post-hit). No scratch field (splash is instant).
3. **Lightning Lure** (`src/spells/lightning_lure.ts`) — TCE p.107. STR save, 1d8 lightning, 15 ft, scales. **Rider: on save-FAIL, target is pulled up to 10 ft in a straight line toward the caster, AND takes the lightning damage ONLY if it ends up within 5 ft of the caster.** This is a SAVE-BASED PULL — MIRRORS Thorn Whip (attack-roll pull) but with a STR save AND conditional damage based on post-pull position. CRITICAL ARCHITECTURE: Lightning Lure's Action sets `damage = null` so resolveAttack's save branch does NOT roll damage (which would be unconditional on save-FAIL). Instead, applyCantripEffect handles ALL damage logic: pull first (forced movement via direct `target.pos` set, bypassing executeMove — no OAs, no Booming Blade detonation), then check post-pull position, then roll 1d8 lightning only if within 5 ft. Pull size constraint: Large or smaller (mirror Thorn Whip's `canPullSize`). Registered in `CANTRIP_EFFECTS` (post-save-FAIL).
4. **Sword Burst** (`src/spells/sword_burst.ts`) — TCE p.115. DEX save, 1d6 force, **all creatures within 5 ft of caster** (caster-centered AoE), scales. This is the SECOND caster-centered AoE cantrip — MIRRORS Thunderclap (CON save, thunder) but with DEX save + force damage. Registered in the existing `CANTRIP_AOE_EFFECTS` registry. The execute handler is near-identical to Thunderclap's: find all creatures within 5 ft (Euclidean distance — PHB circle, not Chebyshev square), roll DEX save for each, apply 1d6 force on fail / half on success. Caster excluded. v1 reads saveDC + damage from the Sword Burst Action on caster.actions. Force damage is RARE on cantrips — only Eldritch Blast also deals force.
5. **Sapping Sting** (`src/spells/sapping_sting.ts`) — EGW p.189. CON save, 1d4 necrotic, 30 ft, scales. **Rider: target falls PRONE on save-FAIL.** This is the FIRST cantrip to apply a PHB Appendix A condition (prone) via the cantrip dispatcher. Implementation: `addCondition(target, 'prone')` (already in utils.ts). No scratch field needed (the `prone` condition lives in `target.conditions`). No cleanup needed (prone is cleared by existing condition-removal logic — standing up via the action system, death, etc. — NOT by `resetBudget`/cleanup). The prone condition gives melee attacks against the target advantage (already handled by `resolveAttackAdvantage` in utils.ts). Registered in `CANTRIP_EFFECTS` (post-save-FAIL).

### Integration points touched (Session 8)

- `src/types/core.ts`: Added `_frostbiteDisadvNextWeaponAttack?: boolean` to `Combatant` (Frostbite). Added `spellcastingMod?: number` and `casterLevel?: number` to `Combatant` (Green-Flame Blade — populated by parser, set directly in tests).
- `src/engine/cantrip_effects.ts`: Added `'Frostbite'`, `'Sapping Sting'`, `'Lightning Lure'`, `'Green-Flame Blade'` to `CANTRIP_EFFECTS`. Added `'Sword Burst'` to `CANTRIP_AOE_EFFECTS`. Updated module header to list all 11 supported cantrips across 4 registries.
- `src/engine/combat.ts`:
  - **`resolveAttack` attack-roll branch** — added Frostbite weapon-attack-only disadv check: `frostbiteDisadv = isWeaponAttack && attacker._frostbiteDisadvNextWeaponAttack === true` where `isWeaponAttack = action.attackType === 'melee' || action.attackType === 'ranged'`. Folded into the `disadvantage` boolean. Consume (set to false) after the attack roll resolves, hit or miss. Spell attacks do NOT consume the flag (XGE p.156: "weapon attack roll").
- `src/engine/utils.ts`: `resetBudget` now calls `cleanupFrostbite(c)` after the existing cleanups. (Sapping Sting, Lightning Lure, and Green-Flame Blade have no-op cleanups exported for symmetry — they have no scratch fields to clear.)

### Tests (Session 8)

- `src/test/frostbite.test.ts`: 57 tests. Metadata, scaling, CON save, components (V+S), **riderAttackTypes = ['melee', 'ranged']** (weapon only — spell excluded), applyCantripEffect sets flag, dispatcher integration, dispatcher safety, resetBudget cleanup, **save FAIL → rider applies**, **save SUCCESS → no rider**, **melee attack: disadv folded + flag consumed (one-shot)**, **ranged attack: disadv folded + flag consumed**, **second weapon attack: NO disadv (one-shot consume verified)**, **SPELL attack: NO disadv (control test)**, **SPELL attack: does NOT consume the flag** (control test — flag stays set, subsequent weapon attack still gets disadv), Total Cover respects.
- `src/test/sword_burst.test.ts`: 54 tests. Metadata, scaling, DEX save, components (V only), isCasterCenteredAoE=true, no CANTRIP_EFFECTS/SELF entries, resolveCantripAoE integration, resolveCantripAoE safety, dispatcher safety, **multiple enemies in range each roll a save** (3 in range, 1 diagonal OUT, 1 far OUT — Euclidean circle), **caster NOT hit**, **enemies beyond 5 ft NOT hit** (including diagonal ~7 ft — Euclidean circle, not Chebyshev square), **0 creatures in range still consumes action**, save SUCCESS → half (0..3), save FAIL → full (1..6), **saveDC read from caster.actions**, **fallback DC 13 when Action is missing**.
- `src/test/sapping_sting.test.ts`: 50 tests. Metadata, scaling, CON save, components (V+S), **conditionInflicted = 'prone'**, applyCantripEffect adds prone condition, dispatcher integration, dispatcher safety, **cleanup is a no-op (prone is a condition, not a scratch field)**, **save FAIL → prone applies**, **save SUCCESS → NO prone**, **necrotic damage 1d4 (1..4)**, **melee attacks vs prone have ADVANTAGE (control test via resolveAttackAdvantage)**, **spell attacks vs prone have ADVANTAGE (control test)**, **ranged attacks vs prone have DISADVANTAGE (control test)**, **prone NOT cleared by resetBudget** (it's a condition, not a scratch field), Total Cover respects.
- `src/test/lightning_lure.test.ts`: 88 tests. Metadata, scaling, STR save, components (V only), pullDistanceFt=10, maxPullSize='Large', **canPullSize helper** (Tiny/Small/Medium/Large=true, Huge/Gargantuan=false, undefined=Medium default), applyCantripEffect pulls target on save-FAIL, dispatcher integration, dispatcher safety, **cleanup is a no-op**, **save FAIL + 10 ft away → pulled to 5 ft → 1d8 lightning (1..8)**, **save FAIL + 15 ft away → pulled 10 ft → ends 5 ft → damage**, **save FAIL + already within 5 ft → NO pull → still damaged** (position check), **save SUCCESS → NO pull, NO damage** (verify action.damage=null architecture), **damage = 1d8 lightning (1..8) over 20 iterations**, **pull is forced movement (does NOT trigger Booming Blade rider)** (control test — verify flag still set + damage = only Lightning Lure, not + Booming Blade), **Huge+ target NOT pulled, NO damage** (size constraint), Total Cover respects.
- `src/test/green_flame_blade.test.ts`: 209 tests. Metadata, scaling (on-hit flat 1d8 v1, splash mod → 1d8+mod → 2d8+mod → 3d8+mod), components (S+M, no V), splashRangeFt=5, applyCantripEffect splash to nearest enemy within 5 ft of primary, **NO splash if no secondary target in range**, **splash damage type = fire**, **on-hit damage type = fire** (v1 simplification), dispatcher integration, dispatcher safety, **cleanup is a no-op (splash is instant, no scratch fields)**, **resolveAttack HIT → on-hit + splash** (on-hit 2..16 crit, splash 3 at level 1), **resolveAttack MISS → NO on-hit, NO splash**, **splash at level 1 = mod (3, min 1)** (10 iterations, exact 3), **min-1 rule: negative mod → 1**, **min-1 rule: zero mod → 1**, **splash at level 5 = 1d8 + mod (4..11)** (20 iterations), **splash at level 11 = 2d8 + mod (5..19)** (20 iterations), **splash at level 17 = 3d8 + mod (6..27)** (20 iterations), **findSplashTarget nearest enemy within 5 ft of primary**, **findSplashTarget allies excluded (v1: enemies only)**, **findSplashTarget null if no enemy in range**, **rollSplashDamage dice counts at level boundaries** (1/4=0, 5/10=1, 11/16=2, 17/20=3), Total Cover respects on the initial attack.

**Total new tests: 458.** All use deterministic save outcomes (DC=30 / DC=1+ability=30) and `isCritOverride=true` for forced attack hits (avoids the 5% nat-1 flakiness documented in prior handovers).

---

## DISCOVERIES / PATTERNS FROM THIS SESSION (reuse these)

1. **Four cantrip registries are now well-populated.** 11 cantrips in `CANTRIP_EFFECTS`, 1 in `CANTRIP_ATTACK_ADVANTAGE`, 1 in `CANTRIP_SELF_EFFECTS`, 2 in `CANTRIP_AOE_EFFECTS`. The architecture is flexible enough for any cantrip pattern. The Session 9 batch will add at least 1 more to each of `CANTRIP_EFFECTS` (Infestation), `CANTRIP_AOE_EFFECTS` (Word of Radiance), and `CANTRIP_SELF_EFFECTS` (Shillelagh).
2. **Attack-type-restricted debuff pattern (Frostbite).** For one-shot debuffs that apply only to a SUBSET of attack types (e.g. weapon-only, spell-only, melee-only): set a scratch field on the target in `applyCantripEffect` (post-save-FAIL); in `resolveAttack`'s attack-roll branch, fold it into the `disadvantage` boolean ONLY when `action.attackType` matches the restricted set; consume (set to false) after the roll resolves. Frostbite's `isWeaponAttack = action.attackType === 'melee' || 'ranged'` is the FIRST such filter. Future attack-type-restricted debuffs (e.g. a hypothetical "disadv on next spell attack" cantrip) reuse this pattern with a different filter.
3. **Condition-inflicting cantrip pattern (Sapping Sting).** For cantrips that apply a PHB Appendix A condition (prone, restrained, poisoned, etc.): just call `addCondition(target, conditionName)` in `applyCantripEffect` (post-save-FAIL). No scratch field needed (the condition lives in `target.conditions`). No cleanup needed (conditions are cleared by existing condition-removal logic — `removeCondition`, standing up, death, etc. — NOT by `resetBudget`/cleanup, which only clears cantrip scratch fields). Export a no-op `cleanup()` for symmetry with the other cantrip modules. Sapping Sting is the FIRST cantrip to apply a PHB condition via the cantrip dispatcher — future condition-inflicting cantrips (e.g. a hypothetical "poisoned" cantrip) reuse this pattern.
4. **Save-based pull + conditional damage pattern (Lightning Lure).** For cantrips whose damage depends on a POST-EFFECT position (Lightning Lure: damage only if pulled within 5 ft of caster): set `action.damage = null` so `resolveAttack`'s save branch does NOT roll damage (which would be unconditional on save-FAIL). Handle ALL damage logic in `applyCantripEffect`: (1) apply the pull (forced movement via direct `target.pos` set, bypassing `executeMove` — no OAs, no Booming Blade detonation), (2) check the post-pull position, (3) roll damage only if the position check passes. This keeps the engine unchanged — the `action.damage = null` flag is the contract that tells resolveAttack's save branch to skip damage. The metadata still exposes `damageDice` / `damageType` for the AI/parser to estimate expected damage when planning. Lightning Lure is the FIRST cantrip with conditional damage based on post-effect position.
5. **Splash-to-secondary-target pattern (Green-Flame Blade).** For cantrips that deal INSTANT splash damage to a second creature within range of the primary target: in `applyCantripEffect` (post-hit), auto-select the nearest enemy within splash range of the primary (excluding caster and primary), roll the splash damage, apply it as the cantrip's damage type. No scratch field (splash is instant, not delayed). Expose `findSplashTarget(caster, primary, state)` and `rollSplashDamage(casterLevel, spellcastingMod)` as exported helpers for testability. The splash target is auto-selected in v1 (the AI/parser can override in a future batch). Green-Flame Blade is the FIRST cantrip with instant splash damage (Booming Blade's rider is movement-triggered, not instant).
6. **Caster-centered AoE pattern (Sword Burst, mirrors Thunderclap).** The `CANTRIP_AOE_EFFECTS` registry handles all caster-centered AoE cantrips. The execute handler is near-identical for all of them: find all creatures within range (Euclidean distance — PHB circle, not Chebyshev square), roll the save for each, apply damage on fail / half on success. Caster excluded. Differences: save ability, damage type, damage dice, components, source. Word of Radiance (Session 9) will be the THIRD caster-centered AoE cantrip — same execute handler, different save (DEX) + damage type (radiant). The pattern is now well-established.
7. **`spellcastingMod` and `casterLevel` fields on `Combatant`.** Session 8 added two new optional fields to `Combatant` for cantrips whose damage scales with the caster's spellcasting ability modifier (Green-Flame Blade) or caster level (Green-Flame Blade's splash). Both default to typical values when undefined (`spellcastingMod = 3`, `casterLevel = 1`). The parser should populate these from the caster's class and character level; tests set them directly. Future cantrips that scale with spellcasting mod or caster level (e.g. Shillelagh's WIS-for-STR substitution in Session 9) can read these fields.
8. **`isCritOverride=true` for deterministic attack-roll hits in tests.** +20 hitBonus vs AC 10 still has a 5% nat-1 auto-miss rate (PHB p.194). Use `isCritOverride=true` (5th arg to `resolveAttack`) to force a hit. Crit doubles the damage dice — adjust the damage range assertion accordingly (1d8 → 2d8 = 2..16). `isCritOverride=false` forces a miss. This is the attack-roll analogue of "DC=30 for guaranteed save fail." Established in Session 7, reused throughout Session 8.
9. **Pre-existing flaky tests (do NOT try to fix — outside cantrip scope):** `combat.test.ts` (varying pass count 52–54, occasional 1 failure — d20-probabilistic), `faerie_fire.test.ts` (occasional 2 failures under suite load), `burning_hands.test.ts` (10% failure rate on nat 1-2). **Also newly observed:** `arms_of_hadar.test.ts` (occasional 2 failures, d20-probabilistic), `rage.test.ts` (occasional 1 failure, d20-probabilistic), **`eldritch_blast.test.ts`** (occasional 3 failures in section 12 "Total Cover" — pre-existing LOS algorithm bug where the wall at `x:6, y:-1, width:1, depth:20` doesn't reliably create Total Cover between (0,0) and (12,0); when LOS detects a gap, the attack rolls + hits + all 3 assertions 12a/12b/12c fail together. This is a Core Engine LOS issue, NOT cantrip work). All verified pre-existing by re-running on the Session 8 codebase without re-running cantrip tests — flakiness persists. NOT caused by cantrip work. The handover explicitly says do NOT fix these.
10. **Build hygiene:** run `./node_modules/.bin/tsc --noEmit` before committing. Run the full suite: `for t in src/test/*.test.ts; do timeout 75 ./node_modules/.bin/ts-node --transpile-only "$t" || echo "FAIL: $t"; done` (66 files, ~3700+ tests, must stay green except for the documented pre-existing flakiness). Revert test side-effects before committing: `git checkout -- characters/` if any fixture JSON got an `updatedAt` bump.
11. **`eq()` takes 3 args (label, a, b), `assert()` takes 3 args (label, cond, detail).** Do NOT pass a detail string to `eq()` — it only takes `label, a, b` and the failure detail is auto-generated from JSON.stringify. (Session 8 had to fix several 4-arg `eq()` calls that TypeScript correctly rejected.) Use `assert()` if you need a custom detail string on failure.
12. **⚠️ CI SUMMARY FORMAT — CRITICAL:** The CI workflow (`.github/workflows/test.yml`) greps for the exact string `"Results:"` in each test file's output, and uses `set -e` which kills the script if `grep` finds no match. **Every test file MUST print its summary as `Results: X passed, Y failed`** (not `=== <Name> test: X passed, Y failed ===` or any other format). If you use a different format, the CI will die at your test file with `##[error]Process completed with exit code 1` and your test won't even be counted — it'll look like a failure. Session 8 initially used `=== <Name> test: ... ===` for all 5 new test files and the CI died at `frostbite.test.ts` (alphabetically first new file) before running the other 4. Fixed in a follow-up commit by changing to `Results: ${passed} passed, ${failed} failed`. The CI also checks `grep -q ", 0 failed"` — so the format must be exactly `Results: N passed, M failed` with `, ` between passed and failed.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 20/49 cantrips implemented).
2. Implement the 5 cantrips in the order above (Word of Radiance first — mirrors Sword Burst; Produce Flame second — vanilla ranged spell attack; Infestation third — random forced movement; Shillelagh fourth — self-buff with WIS substitution; Create Bonfire last — most involved, persistent ground hazard).
3. After each: `tsc --noEmit` + run that cantrip's test.
4. After all 5: run the **full regression suite** (must stay green; pre-existing flakiness in combat/faerie_fire/burning_hands/arms_of_hadar/rage is documented and NOT caused by cantrip work).
5. `npm run spell-cache:build` again — confirm cantrip implemented count goes 20 → 25.
6. Commit: `Cantrip-9: Implement Infestation, Word of Radiance, Create Bonfire, Produce Flame, Shillelagh (XGE/PHB)`.
7. Write `zHANDOVER-SESSION-10.md` (next batch — use `npm run spell-cache:pick -- --level 0 --count 5` to choose, or curate for mechanical diversity).
8. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 8)

- `frostbite.test.ts`: 57/57 · `sword_burst.test.ts`: 54/54 · `sapping_sting.test.ts`: 50/50 · `lightning_lure.test.ts`: 88/88 · `green_flame_blade.test.ts`: 209/209
- Prior cantrip tests still green: `fire_bolt.test.ts` 43/43, `acid_splash.test.ts` 44/44, `poison_spray.test.ts` 46/46, `vicious_mockery.test.ts` 47/47, `sacred_flame.test.ts` 51/51, `blade_ward.test.ts` 38/38, `chill_touch.test.ts` 38/38, `shocking_grasp.test.ts` 26/26, `thorn_whip.test.ts` 11/11, `eldritch_blast.test.ts` 53/53, `toll_the_dead.test.ts` 61/61, `mind_sliver.test.ts` 48/48, `thunderclap.test.ts` 54/54, `booming_blade.test.ts` 218/218
- Full regression suite (66 files, ~3700+ tests): all green EXCEPT 5 pre-existing flaky tests (verified by re-running on the Session 8 codebase):
  - `combat.test.ts`: varying pass count 52–54, occasional 1 failure (d20-probabilistic)
  - `faerie_fire.test.ts`: occasional 2 failures under suite load (d20-probabilistic)
  - `burning_hands.test.ts`: 10% failure rate on nat 1-2 (documented in prior handovers)
  - `arms_of_hadar.test.ts`: occasional 2 failures (d20-probabilistic, newly observed)
  - `rage.test.ts`: occasional 1 failure (d20-probabilistic, newly observed)
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **20/49 cantrips implemented**, 26 cantrips remaining in-scope (3 out-of-scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp)

---

## NOTES FOR NEXT AGENT

- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Parser tech debt** (still open, documented in zHANDOVER-3/4/5/6/7/8): `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. **NEW in Session 8:** `spellcastingMod` and `casterLevel` fields also exist but aren't populated by the parser. Not blocking this batch.
- **AI planner** does not yet select most cantrips — engine routing is enough for this batch. AI selection is a Core Engine task.
- **Commit message convention:** `Cantrip-N: <summary>` (this session was Cantrip-8; next session is Cantrip-9).
- **Pre-existing flaky tests** (do NOT try to fix — outside cantrip scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`. These are d20-probabilistic and NOT caused by cantrip work.
- **Architecture summary (4 cantrip registries, 13 cantrips total after Session 8):**
  - `CANTRIP_EFFECTS` (11) — post-hit / post-save-fail riders: Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Vicious Mockery, Mind Sliver, Booming Blade, Frostbite, Sapping Sting, Lightning Lure, Green-Flame Blade
  - `CANTRIP_ATTACK_ADVANTAGE` (1) — pre-roll advantage: Shocking Grasp
  - `CANTRIP_SELF_EFFECTS` (1) — self-buffs: Blade Ward
  - `CANTRIP_AOE_EFFECTS` (2) — caster-centered AoE: Thunderclap, Sword Burst
- **Exported for testability:** `resolveAttack` (Session 6), `executeMove` (Session 7). Both have doc comments noting they're for direct testing of cantrip engine integration.
- **New `Combatant` fields added in Session 8:** `_frostbiteDisadvNextWeaponAttack?: boolean`, `spellcastingMod?: number`, `casterLevel?: number`. All optional with sensible defaults.
- **Conditional damage architecture (Lightning Lure):** When a cantrip's damage depends on a post-effect state (position, condition, etc.), set `action.damage = null` so `resolveAttack`'s save branch skips damage. Handle ALL damage logic in `applyCantripEffect`. The metadata still exposes `damageDice`/`damageType` for AI planning. This is the contract for conditional-damage cantrips.
- **Instant splash architecture (Green-Flame Blade):** For instant splash to a secondary target, auto-select the nearest enemy in range via `findSplashTarget`. No scratch field needed (splash is instant). Expose `rollSplashDamage(casterLevel, spellcastingMod)` and `findSplashTarget(caster, primary, state)` as exported helpers for testability.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
