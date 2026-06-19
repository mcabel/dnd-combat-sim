# zHANDOVER-SESSION-8

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `c975049` — Cantrip-6: Implement Fire Bolt, Acid Splash, Poison Spray, Vicious Mockery, Sacred Flame (PHB)
  - `7009abf` — Cantrip-6: add zHANDOVER-SESSION-6 planning handover
  - `bc4d033` — Cantrip-3/4/5: Recover lost sessions (Chill Touch + Blade Ward + handovers)
  - `f2f40a3` — Spell-cache: per-level cache + batch picker tooling
- Commits this session:
  - `<new>` — Cantrip-7: Implement Eldritch Blast, Toll the Dead, Mind Sliver, Thunderclap, Booming Blade (PHB/XGE/TCE)
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
- Implement cantrips per PHB/XGE/TCE/EGW (2014 canon, pre-2024 only). Sessions 1–7 implemented 15 cantrips. This session extends to the **next batch of 5 combat cantrips**.
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts` — now **FOUR registries** (Session 7 added `CANTRIP_AOE_EFFECTS`):
  - `CANTRIP_EFFECTS` — post-hit / post-save-fail riders
  - `CANTRIP_ATTACK_ADVANTAGE` — pre-roll advantage (Shocking Grasp vs metal)
  - `CANTRIP_SELF_EFFECTS` — non-attack self-buffs (Blade Ward)
  - `CANTRIP_AOE_EFFECTS` — caster-centered AoE (Thunderclap)
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-7.md`** (Session 7 patterns: Mind Sliver's `rollSave` integration, Booming Blade's `executeMove` movement hook, Thunderclap's `CANTRIP_AOE_EFFECTS` registry, Toll the Dead's conditional damage at Action-build time, Eldritch Blast's multi-beam v1 simplification) — these are your templates. Session 7 also **exported `executeMove`** for testability (mirror how `resolveAttack` was exported in Session 6).
3. Read `zHANDOVER-SESSION-6.md` (Vicious Mockery one-shot-debuff pattern + Sacred Flame `bypassesCover`) and `zHANDOVER-SESSION-4.md` (Blade Ward self-buff pattern) — also templates.
4. Read `SPELL-CACHE.md` — it explains the cache + picker workflow.
5. Run `npm install` (deps: ts-node, typescript).
6. Run `npm run spell-cache:build` — refresh the cache (confirm 15/49 cantrips implemented).
7. For each cantrip below, run `npm run spell-cache:show -- "Name"` to get the full raw 5etools JSON (entries, scalingLevelDice, components) before implementing.

---

## GOALS THIS SESSION — Batch: 5 combat cantrips (mechanically diverse)

Picked from `spell-cache/level-0.json` (curated for mechanical diversity — each exercises a NEW pattern or extends an existing one with a different save ability / damage type). These 5 push the cantrip architecture further: a save-based pull (Lightning Lure), a prone-inflicting cantrip (Sapping Sting), a second-target splash (Green-Flame Blade), a CON-save debuff (Frostbite), and a DEX-save caster-centered AoE (Sword Burst).

| # | Name | School | Effect | Source | Page | Module to create |
|---|------|--------|--------|--------|------|------------------|
| 1 | **Frostbite** | Evocation | CON save · 1d6 cold · 60 ft · **disadv on target's next WEAPON attack roll** · +scales | XGE (2017-11-21) | 156 | `src/spells/frostbite.ts` |
| 2 | **Green-Flame Blade** | Evocation | melee spell attack · 1d8 fire (v1 simplification) · reach 5 ft · **splash: fire damage to a second creature within 5 ft of target** · +scales | TCE (2020-11-17) | 107 | `src/spells/green_flame_blade.ts` |
| 3 | **Lightning Lure** | Evocation | STR save · 1d8 lightning (only if pulled within 5 ft) · 15 ft · **pull target 10 ft toward caster on save-fail** · +scales | TCE (2020-11-17) | 107 | `src/spells/lightning_lure.ts` |
| 4 | **Sword Burst** | Conjuration | DEX save · 1d6 force · **all creatures within 5 ft of caster** · +scales | TCE (2020-11-17) | 115 | `src/spells/sword_burst.ts` |
| 5 | **Sapping Sting** | Necromancy | CON save · 1d4 necrotic · 30 ft · **target falls prone on save-fail** · +scales | EGW (2020-03-17) | 189 | `src/spells/sapping_sting.ts` |

### Implementation checklist (paste into the session's completion notes)

- [ ] **Frostbite** (`XGE p.156`) — CON save, 1d6 cold, scales. **Rider: target has disadv on the next WEAPON attack roll it makes before the end of its next turn.** This is a one-shot debuff MIRRORING Vicious Mockery (WIS save, psychic, disadv on next attack) but with CON save + cold damage + "weapon attack only" (excludes spell attacks). Reuse the Vicious Mockery scratch-field + consume-on-attack pattern, BUT: the consume check in `resolveAttack`'s attack-roll branch must filter by `action.attackType === 'melee' || action.attackType === 'ranged'` (NOT 'spell'). Add a new scratch field `_frostbiteDisadvNextWeaponAttack?: boolean` on `Combatant` (do NOT reuse `_viciousMockeryDisadvNextAttack` — Vicious Mockery applies to ALL attacks, Frostbite only to weapon attacks). Register in `CANTRIP_EFFECTS` (post-save-FAIL). Add `cleanup()` clearing the flag (called from `resetBudget`).
- [ ] **Green-Flame Blade** (`TCE p.107`) — melee spell attack, reach 5 ft, scales. **Splash rider: on hit, fire damage leaps from the target to a second creature of the caster's choice within 5 ft of the target.** This MIRRORS Booming Blade (melee cantrip with a rider) but the rider is INSTANT splash damage (not a movement trigger). v1 simplification: on-hit damage = 1d8 fire (ignoring weapon damage, same simplification as Booming Blade); splash damage = caster's spellcasting mod (min 1) at levels 1–4, scaling to 1d8+mod at 5+, 2d8+mod at 11+, 3d8+mod at 17+. The splash target is chosen by the AI/parser (set `plan.targetId` to the primary, add a NEW field for the splash target — OR have the cantrip module auto-select the nearest other enemy within 5 ft of the primary). Recommendation: auto-select nearest enemy within 5 ft of primary (simpler, no Action shape changes). Register in `CANTRIP_EFFECTS` (post-hit). The splash uses `applyDamageWithTempHP` with fire damage type.
- [ ] **Lightning Lure** (`TCE p.107`) — STR save, 1d8 lightning, 15 ft, scales. **Rider: on save-FAIL, target is pulled up to 10 ft in a straight line toward the caster, AND takes the lightning damage ONLY if it ends up within 5 ft of the caster.** This is a SAVE-BASED PULL — mirrors Thorn Whip (attack-roll pull) but with a STR save. Reuse `pullTarget`-style logic from `thorn_whip.ts` BUT: (a) the pull happens BEFORE damage (so the damage check `if within 5 ft` works), (b) pull only on save-FAIL (Thorn Whip pulls on hit), (c) damage is conditional on post-pull position. Register in `CANTRIP_EFFECTS` (post-save-FAIL). The pull is forced movement (does NOT trigger Booming Blade's movement rider or opportunity attacks — mirror Thorn Whip's pull semantics). Pull size constraint: Large or smaller (mirror Thorn Whip's `canPullSize`).
- [ ] **Sword Burst** (`TCE p.115`) — DEX save, 1d6 force, **all creatures within 5 ft of caster** (caster-centered AoE), scales. This is a SECOND caster-centered AoE cantrip — MIRRORS Thunderclap (CON save, thunder) but with DEX save + force damage. Register in the existing `CANTRIP_AOE_EFFECTS` registry (Session 7 added it). The execute handler should be near-identical to Thunderclap's: find all creatures within 5 ft (Euclidean), roll DEX save for each, apply 1d6 force on fail / half on success. Caster is excluded. v1: read saveDC + damage from the Sword Burst Action on caster.actions.
- [ ] **Sapping Sting** (`EGW p.189`) — CON save, 1d4 necrotic, 30 ft, scales. **Rider: target falls PRONE on save-FAIL.** This is a CONDITION-INFLICTING cantrip — the first cantrip to apply a condition (prone) via the post-save-FAIL dispatcher. Use `addCondition(target, 'prone')` (already in utils.ts). Register in `CANTRIP_EFFECTS` (post-save-FAIL). No scratch field needed — the `prone` condition is tracked in `target.conditions` and is cleared by existing condition-removal logic (not by a cantrip cleanup). The prone condition gives melee attacks against the target advantage (already handled by `resolveAttackAdvantage` in utils.ts). Document that Sapping Sting is the first cantrip to apply a PHB Appendix A condition via the cantrip dispatcher.

### Integration points you will touch (expected)

- `src/types/core.ts`: Add `_frostbiteDisadvNextWeaponAttack?: boolean` to `Combatant` (Frostbite). Green-Flame Blade, Lightning Lure, Sword Burst, Sapping Sting need NO new scratch fields (Green-Flame Blade's splash is instant; Lightning Lure's pull is forced movement via direct pos set, like Thorn Whip; Sword Burst uses the existing CANTRIP_AOE_EFFECTS registry; Sapping Sting uses the existing `prone` condition).
- `src/engine/cantrip_effects.ts`: Add `'Frostbite'`, `'Green-Flame Blade'`, `'Lightning Lure'`, `'Sapping Sting'` to `CANTRIP_EFFECTS`. Add `'Sword Burst'` to `CANTRIP_AOE_EFFECTS`.
- `src/engine/combat.ts`:
  - `resolveAttack` attack branch — add Frostbite weapon-attack-only disadv check: `frostbiteDisadv = attacker._frostbiteDisadvNextWeaponAttack === true && (action.attackType === 'melee' || action.attackType === 'ranged')`. Fold into the `disadvantage` boolean. Consume (set to false) after the attack roll resolves, hit or miss (one-shot, mirror Vicious Mockery).
  - `executePlannedAction` `case 'cast':` — no changes needed (Sword Burst auto-routes via `resolveCantripAoE`).
  - `executeMove` — no changes needed (Lightning Lure's pull is forced movement via direct pos set, bypassing executeMove — mirror Thorn Whip).
- `src/engine/utils.ts`: `resetBudget` — add `cleanupFrostbite(c)` (clears the flag if not consumed by a weapon attack before end of target's next turn).
- **Do NOT** touch the AI planner (`src/ai/planner.ts`) — that's Core Engine territory.

### Tests (write one `*.test.ts` per cantrip, in the repo's ts-node convention)

Mirror `src/test/booming_blade.test.ts` (218 tests — uses exported `executeMove` for end-to-end movement hook verification) and `src/test/thunderclap.test.ts` (54 tests — uses `resolveCantripAoE` for AoE cantrip verification) for structure. Use deterministic save outcomes (DC=30 for guaranteed fail, DC=1 + ability=30 for guaranteed success) and `isCritOverride=true` for forced attack-roll hits (avoids the 5% nat-1 flakiness — see Session 7's Booming Blade test section 10 for the pattern). Target ~20–50 tests per cantrip. Each test file must exit non-zero on failure (`process.exit(1)`).

**Critical test cases per cantrip:**
- Frostbite: metadata; CON save; **rider applies −disadv on save-fail**; **rider consumed on next WEAPON attack only** (one-shot — spell attacks do NOT consume it); **rider cleared by resetBudget**; **save-success applies no rider**; **spell attacks do NOT get disadv from Frostbite** (control test — cast a spell attack with the flag set, verify no disadv log).
- Green-Flame Blade: metadata; melee spell attack; **splash damage to second creature within 5 ft of primary on hit** (construct primary + secondary within 5 ft, verify both take damage); **no splash if no secondary target in range** (only primary takes on-hit damage); **splash damage type = fire**; **on-hit damage type = fire** (v1 simplification); scales.
- Lightning Lure: metadata; STR save; **save-fail → pull target 10 ft toward caster** (verify position change); **save-fail + pulled within 5 ft → 1d8 lightning damage**; **save-fail + NOT pulled within 5 ft (e.g. already adjacent) → no damage** (position check); **save-success → no pull, no damage**; **pull is forced movement (does NOT trigger Booming Blade rider)** (control test); **Large or smaller only** (Huge+ target not pulled, mirror Thorn Whip size check); scales.
- Sword Burst: metadata; DEX save; **caster-centered AoE (all within 5 ft)** — verify multiple enemies in range each roll a save; **caster is NOT hit**; enemies beyond 5 ft are NOT hit; **diagonal enemies (~7 ft) NOT hit** (Euclidean circle, not Chebyshev — mirror Thunderclap test section 13); scales; **registered in CANTRIP_AOE_EFFECTS** (resolveCantripAoE returns true).
- Sapping Sting: metadata; CON save; **rider applies `prone` condition on save-fail** (verify `target.conditions.has('prone')`); **save-success applies NO prone**; **melee attacks against prone target have advantage** (control test — verify resolveAttackAdvantage returns advantage); prone is NOT cleared by resetBudget (it's a condition, not a scratch field — cleared by standing up via the action system, future work).

---

## COMPLETED THIS SESSION (Session 7, for reference)

### Feature: 5 cantrips implemented

1. **Eldritch Blast** (`src/spells/eldritch_blast.ts`) — PHB p.237. Ranged spell attack, 1d10 force, 120 ft. **v1 SIMPLIFICATION: single-beam only.** Multi-beam scaling (2/3/4 beams at 5/11/17) is documented as TODO via `scalesByBeamCount`, `beamCountByLevel`, `multiBeamV1Implemented: false` metadata flags. The `force` damage type is new to the cantrip roster (no prior cantrip deals force — good for damage-type coverage testing). Metadata only (no rider).
2. **Toll the Dead** (`src/spells/toll_the_dead.ts`) — XGE p.169. WIS save, 1d8 necrotic (or **1d12 if target missing any HP**), 60 ft. **First cantrip with conditional damage dice.** Implementation: METADATA + `damageSidesForTarget(target)` helper. The AI/parser checks `target.currentHP < target.maxHP` at Action-build time and sets `action.damage.sides` to 8 (full HP) or 12 (wounded). No CANTRIP_EFFECTS entry (conditional handled at Action-build, not post-hit).
3. **Mind Sliver** (`src/spells/mind_sliver.ts`) — TCE p.108. INT save, 1d6 psychic, 60 ft. **Rider: −1d4 to target's next saving throw before end of caster's next turn.** One-shot save debuff — MIRRORS Vicious Mockery (one-shot attack debuff) but at a DIFFERENT CHOKE POINT: `rollSave()` in utils.ts (Vicious Mockery integrated into `resolveAttack`'s attack-roll branch). New scratch field `_mindSliverDiePenaltyNextSave?: number` on `Combatant` (stores die size, 4 = d4). Registered in `CANTRIP_EFFECTS` (post-save-FAIL). Cleanup via `resetBudget`.
4. **Thunderclap** (`src/spells/thunderclap.ts`) — XGE p.168. CON save, 1d6 thunder, **all creatures within 5 ft of caster** (caster-centered AoE), scales. **First caster-centered AoE cantrip.** Implementation: NEW 4th registry `CANTRIP_AOE_EFFECTS` + `resolveCantripAoE()` router in `cantrip_effects.ts`. The execute handler finds all creatures within 5 ft (Euclidean distance — PHB circle, not Chebyshev), rolls CON save for each, applies 1d6 thunder on fail / half on success. Caster excluded. Reads saveDC + damage from the Thunderclap Action on caster.actions.
5. **Booming Blade** (`src/spells/booming_blade.ts`) — TCE p.106. Melee spell attack, 1d8 thunder, reach 5 ft. **Rider: if target moves willingly before start of caster's next turn, takes 1d8 thunder (scales).** First MOVEMENT-TRIGGERED damage rider. New scratch fields `_boomingBladePendingDamageDice?: string` + `_boomingBladeCasterId?: string` on `Combatant`. Hook lives in `executeMove()` in combat.ts (NEW CHOKE POINT) — fires after `mover.pos = { ...dest }` when `cost >= 5` (willing move ≥5 ft). Forced movement (Thorn Whip pull, Thunderwave push, grapple drag) bypasses `executeMove` and does NOT trigger the rider. Registered in `CANTRIP_EFFECTS` (post-hit). Cleanup via `resetBudget`.

### Integration points touched (Session 7)

- `src/types/core.ts`: Added `_mindSliverDiePenaltyNextSave?: number`, `_boomingBladePendingDamageDice?: string`, `_boomingBladeCasterId?: string` to `Combatant`.
- `src/engine/cantrip_effects.ts`: Added `'Mind Sliver'` and `'Booming Blade'` to `CANTRIP_EFFECTS`. **Created NEW `CANTRIP_AOE_EFFECTS` registry + `resolveCantripAoE()` router** for caster-centered AoE cantrips (Thunderclap registered). Updated module header to document the 4 registries.
- `src/engine/combat.ts`:
  - **Exported `executeMove`** (was internal) for direct testing of the Booming Blade movement hook. Added a doc comment noting it's for testability (mirror Session 6's `resolveAttack` export).
  - **`case 'cast':`** now calls `resolveCantripAoE(actor, plan.action.name, state)` AFTER `resolveCantripAction` and BEFORE the target-null guard. AoE cantrips bypass `resolveAttack` entirely.
  - **`executeMove`** has a new Booming Blade hook: after `mover.pos = { ...dest }`, if `mover._boomingBladePendingDamageDice` is set AND `cost >= 5`, roll the dice, apply thunder damage via `applyDamageWithTempHP`, log, clear the flag. If the mover dies from the rider, skip the OA loop.
- `src/engine/utils.ts`:
  - **`rollSave`** now folds `_mindSliverDiePenaltyNextSave` into the save total (subtracts `rollDie(value)`), then CONSUMES the flag (delete) regardless of success/failure. New choke point for save debuffs.
  - **`resetBudget`** calls `cleanupMindSliver(c)` + `cleanupBoomingBlade(c)` after the existing cleanups.

### Tests (Session 7)

- `src/test/eldritch_blast.test.ts`: 53 tests. Metadata, scaling, multi-beam scaling metadata (scalesByBeamCount, beamCountByLevel, multiBeamV1Implemented=false), components (V+S), force damage type (new to roster), no CANTRIP_EFFECTS/SELF/AoE entries, dispatcher safety, Action shape, resolveAttack hit (forced crit via isCritOverride=true to avoid nat-1 flakiness — 2d10=2..20 range), resolveAttack miss, Total Cover respects, v1 single-beam simplification documented.
- `src/test/toll_the_dead.test.ts`: 61 tests. Metadata, scaling (full HP 1d8→4d8 + wounded 1d12→4d12), WIS save, components (V+S), `damageSidesForTarget` helper (full HP→8, wounded→12, edge cases), `damageDiceForTarget` helper (scales with caster level), no CANTRIP_EFFECTS/SELF/AoE entries, dispatcher safety, Action shape, save FAIL (full HP, 1d8=1..8), save SUCCESS (half, 0..4), save FAIL (wounded, 1d12=1..12), Total Cover respects.
- `src/test/mind_sliver.test.ts`: 48 tests. Metadata, scaling, INT save, components (V only), riderDieSides=4, applyCantripEffect sets flag=4, dispatcher integration, dispatcher safety, resetBudget cleanup, save FAIL → rider applies, save SUCCESS → no rider, **rollSave subtracts 1d4 penalty** (total in 1..23), **rider consumed after one save** (one-shot), second save no penalty, Total Cover respects.
- `src/test/thunderclap.test.ts`: 54 tests. Metadata, scaling, CON save, components (S only), isCasterCenteredAoE=true, no CANTRIP_EFFECTS/SELF entries, resolveCantripAoE integration, resolveCantripAoE safety, dispatcher safety, **multiple enemies in range each roll a save** (3 in range, 1 out of range), **caster NOT hit**, **enemies beyond 5 ft NOT hit** (including diagonal ~7 ft — Euclidean circle), **0 creatures in range still consumes action**, save SUCCESS → half (0..3), save FAIL → full (1..6), **saveDC read from caster.actions**.
- `src/test/booming_blade.test.ts`: 218 tests. Metadata, scaling (on-hit v1 flat 1d8 + rider 1d8→4d8), components (S+M, no V), riderDiceByLevel, applyCantripEffect sets flag='1d8'+casterId, dispatcher integration, dispatcher safety, resetBudget cleanup, **resolveAttack HIT (forced crit) → rider applies** (2d8 on-hit=2..16, rider flag='1d8' unaffected by crit), resolveAttack MISS → no rider, **executeMove willing move → rider detonates** (end-to-end via exported executeMove: HP reduced 1..8, flag cleared, detonation log with 'thunder'), executeMove no rider → no detonation, **forced movement (direct pos set) → rider does NOT detonate** (flag still set, HP unchanged), second move after detonation → no further damage (one-shot), Total Cover respects on initial attack, **rollDiceString helper** (1d8/2d8/4d8 ranges, invalid format → 0).

**Total new tests: 434.** All use deterministic save outcomes (DC=30 / DC=1+ability=30) and `isCritOverride=true` for forced attack hits (avoids the 5% nat-1 flakiness documented in prior handovers).

---

## DISCOVERIES / PATTERNS FROM THIS SESSION (reuse these)

1. **Four cantrip registries now exist.** The architecture is flexible enough for any cantrip pattern:
   - `CANTRIP_EFFECTS` — post-hit (attack cantrips) OR post-save-FAIL (save cantrips). Same dispatcher, different choke points in `resolveAttack`.
   - `CANTRIP_ATTACK_ADVANTAGE` — pre-roll advantage (Shocking Grasp vs metal).
   - `CANTRIP_SELF_EFFECTS` — non-attack self-buffs (Blade Ward).
   - `CANTRIP_AOE_EFFECTS` — caster-centered AoE (Thunderclap, Sword Burst next batch). The execute handler finds all targets in range itself; `resolveCantripAoE` returns true if the name is registered (even if 0 targets in range — the spell is still cast).
2. **One-shot debuff pattern (Vicious Mockery → Mind Sliver).** For "disadv on next X" or "−1d4 to next save" riders: set a scratch field on the target in `applyCantripEffect` (post-save-FAIL); fold it into the roll at the appropriate choke point (`resolveAttack` attack-roll branch for attack debuffs, `rollSave` for save debuffs); consume (set to false/undefined) after the roll resolves; cleanup via `resetBudget`. **Mind Sliver's `rollSave` integration is the new save-debuff choke point** — future save debuffs (e.g. a hypothetical "−1d4 to next CON save" cantrip) reuse this.
3. **Movement-triggered rider pattern (Booming Blade).** For riders that fire on a specific trigger (movement, attack, save, etc.): set a scratch field on the target in `applyCantripEffect`; hook into the engine function that handles that trigger (`executeMove` for willing movement); roll + apply + clear the flag inside the hook. **`executeMove` is the willing-movement choke point** — forced movement (Thorn Whip pull, Thunderwave push, grapple drag) modifies `pos` directly without calling `executeMove`, so it does NOT trigger movement-based riders. This is PHB-correct ("willingly moves" = uses the creature's own movement). `executeMove` is now EXPORTED for direct testing (mirror `resolveAttack`).
4. **Conditional damage at Action-build time (Toll the Dead).** When damage dice depend on target state (HP, conditions, etc.), the conditional cannot be applied by a post-hit/post-save-fail rider (damage is rolled BEFORE the dispatcher runs). Solution: the AI/parser inspects the target at Action-build time and sets `action.damage.sides` accordingly. The cantrip module exposes BOTH damage tracks in metadata + a helper (`damageSidesForTarget(target)`) for the AI/parser to call. This avoids touching `Action` type or `resolveAttack`. Future conditional-damage cantrips (e.g. a hypothetical "1d6 + 1d6 vs undead" cantrip) reuse this pattern.
5. **Multi-beam scaling is a future AI-planner task (Eldritch Blast).** Eldritch Blast's scaling produces MULTIPLE attack rolls (2/3/4 beams at 5/11/17), not bigger dice. `resolveAttack` resolves ONE attack per Action; multi-beam routing requires either (a) the AI planner to emit multiple `cast` PlannedActions (one per beam) — a Core-Engine/AI-planner task, NOT a cantrip-module task, OR (b) a new "multi-attack cantrip" registry that loops the attack-roll + damage per beam. v1 provides metadata only for a single beam + `scalesByBeamCount`/`beamCountByLevel`/`multiBeamV1Implemented=false` flags so the AI planner can read this in a future batch.
6. **`isCritOverride=true` for deterministic attack-roll hits in tests.** +20 hitBonus vs AC 10 still has a 5% nat-1 auto-miss rate (PHB p.194). Use `isCritOverride=true` (5th arg to `resolveAttack`) to force a hit. Crit doubles the damage dice — adjust the damage range assertion accordingly (1d8 → 2d8 = 2..16). `isCritOverride=false` forces a miss. This is the attack-roll analogue of "DC=30 for guaranteed save fail."
7. **Exported `executeMove` for testing.** Previously internal, now exported with a doc comment noting it's for testability. This enables direct testing of the Booming Blade movement hook (and future movement-based riders) without going through `runCombat` + AI planner. Mirror Session 6's `resolveAttack` export. Normal callers should still use `runCombat` / `executeTurnPlan`.
8. **Pre-existing flaky tests (do NOT try to fix — outside cantrip scope):** `combat.test.ts` (varying pass count 44–62, occasional 1 failure — d20-probabilistic), `faerie_fire.test.ts` (occasional 2 failures under suite load), `burning_hands.test.ts` (10% failure rate on nat 1-2). **Verified pre-existing** by stashing Session 7 engine changes and re-running — flakiness persists on the pristine engine. NOT caused by cantrip work. The handover explicitly says do NOT fix these.
9. **Build hygiene:** run `./node_modules/.bin/tsc --noEmit` before committing. Run the full suite: `for t in src/test/*.test.ts; do timeout 75 ./node_modules/.bin/ts-node --transpile-only "$t" || echo "FAIL: $t"; done` (56 files, ~3300+ tests, must stay green except for the documented pre-existing flakiness).
10. **Revert test side-effects** before committing: `git checkout -- characters/` if any fixture JSON got an `updatedAt` bump.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 15/49 cantrips implemented).
2. Implement the 5 cantrips in the order above (Frostbite first — mirrors Vicious Mockery; Sword Burst second — mirrors Thunderclap; Sapping Sting + Lightning Lure + Green-Flame Blade last — most involved).
3. After each: `tsc --noEmit` + run that cantrip's test.
4. After all 5: run the **full regression suite** (must stay green; pre-existing flakiness in combat/faerie_fire/burning_hands is documented and NOT caused by cantrip work).
5. `npm run spell-cache:build` again — confirm cantrip implemented count goes 15 → 20.
6. Commit: `Cantrip-8: Implement Frostbite, Green-Flame Blade, Lightning Lure, Sword Burst, Sapping Sting (XGE/TCE/EGW)`.
7. Write `zHANDOVER-SESSION-9.md` (next batch — use `npm run spell-cache:pick -- --level 0 --count 5` to choose, or curate for mechanical diversity).
8. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 7)

- `eldritch_blast.test.ts`: 53/53 · `toll_the_dead.test.ts`: 61/61 · `mind_sliver.test.ts`: 48/48 · `thunderclap.test.ts`: 54/54 · `booming_blade.test.ts`: 218/218
- Prior cantrip tests still green: `fire_bolt.test.ts` 43/43, `acid_splash.test.ts` 44/44, `poison_spray.test.ts` 46/46, `vicious_mockery.test.ts` 47/47, `sacred_flame.test.ts` 51/51, `blade_ward.test.ts` 38/38, `chill_touch.test.ts` 38/38, `shocking_grasp.test.ts` 26/26, `thorn_whip.test.ts` 11/11
- Full regression suite (60 files, ~3300+ tests): all green EXCEPT 3 pre-existing flaky tests (verified by stashing Session 7 changes and re-running on pristine engine):
  - `combat.test.ts`: varying pass count 44–62, occasional 1 failure (d20-probabilistic)
  - `faerie_fire.test.ts`: occasional 2 failures under suite load (d20-probabilistic)
  - `burning_hands.test.ts`: 10% failure rate on nat 1-2 (documented in prior handovers)
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **15/49 cantrips implemented**, 31 cantrips remaining in-scope (3 out-of-scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp)

---

## NOTES FOR NEXT AGENT

- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Parser tech debt** (still open, documented in zHANDOVER-3/4/5/6/7): `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. Not blocking this batch.
- **AI planner** does not yet select most cantrips — engine routing is enough for this batch. AI selection is a Core Engine task.
- **Commit message convention:** `Cantrip-N: <summary>` (this session was Cantrip-7; next session is Cantrip-8).
- **Pre-existing flaky tests** (do NOT try to fix — outside cantrip scope, verified pre-existing by stashing Session 7 changes): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`. These are d20-probabilistic and NOT caused by cantrip work.
- **Architecture summary (4 cantrip registries):**
  - `CANTRIP_EFFECTS` — post-hit / post-save-fail riders (Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Vicious Mockery, Mind Sliver, Booming Blade)
  - `CANTRIP_ATTACK_ADVANTAGE` — pre-roll advantage (Shocking Grasp)
  - `CANTRIP_SELF_EFFECTS` — self-buffs (Blade Ward)
  - `CANTRIP_AOE_EFFECTS` — caster-centered AoE (Thunderclap)
- **Exported for testability:** `resolveAttack` (Session 6), `executeMove` (Session 7). Both have doc comments noting they're for direct testing of cantrip engine integration.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
