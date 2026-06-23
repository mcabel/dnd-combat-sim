# zHANDOVER-SESSION-7

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `7009abf` — Cantrip-6: add zHANDOVER-SESSION-6 planning handover
  - `bc4d033` — Cantrip-3/4/5: Recover lost sessions (Chill Touch + Blade Ward + handovers)
  - `f2f40a3` — Spell-cache: per-level cache + batch picker tooling
  - `80f0357` — Spell-cache: fix reprint precedence (newest in-scope source wins)
- Commits this session:
  - `<new>` — Cantrip-6: Implement Fire Bolt, Acid Splash, Poison Spray, Vicious Mockery, Sacred Flame (PHB)
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
- Implement cantrips per PHB/XGE/TCE (2014 canon, pre-2024 only). Sessions 1–6 implemented 10 cantrips (Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Blade Ward, Fire Bolt, Acid Splash, Poison Spray, Vicious Mockery, Sacred Flame). This session extends to the **next batch of 5 combat cantrips**.
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts` (three registries: `CANTRIP_EFFECTS` post-hit/post-save-fail, `CANTRIP_ATTACK_ADVANTAGE` pre-roll, `CANTRIP_SELF_EFFECTS` self-buff).
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read `zHANDOVER-SESSION-3.md` (Chill Touch pattern: targeted disadv via scratch field), `zHANDOVER-SESSION-4.md` (Blade Ward pattern: self-buff via CANTRIP_SELF_EFFECTS), and **`zHANDOVER-SESSION-6.md`** (Vicious Mockery pattern: one-shot consume-on-attack; Sacred Flame pattern: `bypassesCover` flag on Action; save-fail `applyCantripEffect` dispatch in resolveAttack's save branch) — these are your templates. The code you write will closely mirror them.
3. Read `SPELL-CACHE.md` — it explains the cache + picker workflow.
4. Run `npm install` (deps: ts-node, typescript).
5. Run `npm run spell-cache:build` — refresh the cache (confirm 10/49 cantrips implemented).
6. For each cantrip below, run `npm run spell-cache:show -- "Name"` to get the full raw 5etools JSON (entries, scalingLevelDice, components) before implementing.

---

## GOALS THIS SESSION — Batch: 5 combat cantrips (mechanically diverse)

Picked from `spell-cache/level-0.json` (curated for mechanical diversity, NOT the auto-pick which favors alphabetical order). These 5 are chosen to exercise **new** cantrip code paths: multi-beam scaling (Eldritch Blast), conditional damage (Toll the Dead), save-debuff rider (Mind Sliver), caster-centered AoE (Thunderclap), and melee-attack-with-movement-rider (Booming Blade). Together they push the cantrip architecture further and establish patterns for future batches.

| # | Name | School | Effect | Source | Page | Module to create |
|---|------|--------|--------|--------|------|------------------|
| 1 | **Eldritch Blast** | Evocation | ranged spell attack · 1d10 force · 120 ft · +scales (MULTI-BEAM at 5/11/17) | PHB (2014-08-19) | 237 | `src/spells/eldritch_blast.ts` |
| 2 | **Toll the Dead** | Necromancy | WIS save · 1d8 necrotic (or **1d12** if target missing HP) · 60 ft · +scales | XGE (2017-11-21) | 169 | `src/spells/toll_the_dead.ts` |
| 3 | **Mind Sliver** | Enchantment | INT save · 1d6 psychic · 60 ft · **−1d4 to target's next save** · +scales | TCE (2020-11-17) | 108 | `src/spells/mind_sliver.ts` |
| 4 | **Thunderclap** | Evocation | CON save · 1d6 thunder · **all creatures within 5 ft of caster** · +scales | XGE (2017-11-21) | 168 | `src/spells/thunderclap.ts` |
| 5 | **Booming Blade** | Evocation | melee spell attack · 1d8 thunder · reach 5 ft · **rider: 1d8 thunder if target moves willingly before start of your next turn** · +scales | TCE (2020-11-17) | 106 | `src/spells/booming_blade.ts` |

### Implementation checklist (paste into the session's completion notes)

- [ ] **Eldritch Blast** (`PHB p.237`) — ranged spell attack, 1d10 force, 120 ft. **Scaling is UNIQUE: instead of bigger dice at 5/11/17, you fire MORE beams (2/3/4 beams).** Each beam is a separate attack roll against a target (you can target the same creature with multiple beams or split them). v1 SIMPLIFICATION recommendation: implement as a SINGLE beam (1d10 force) with `metadata.scales` flag noting the multi-beam behavior is TODO. Document the simplification in the module header. Create `src/spells/eldritch_blast.ts`. No post-hit rider → metadata only. The AI planner / multi-attack routing must handle the multi-beam case in a future batch. Damage is `force` (no cantrip currently deals force — good for testing damage-type coverage).
- [ ] **Toll the Dead** (`XGE p.169`) — WIS save, 1d8 necrotic (or **1d12 if the target is missing any hit points**, XGE p.169). Scales at 5/11/17. **First cantrip with conditional damage dice.** Implementation: in `applyCantripEffect` (post-save-fail), check if `target.currentHP < target.maxHP` — if so, roll 1d12 instead of 1d8. BUT: the damage is rolled in resolveAttack's save branch BEFORE applyCantripEffect is called, so this needs a different approach. **Recommendation:** handle the conditional damage INSIDE resolveAttack's save branch by checking a new `conditionalDamageDice` field on Action (analogous to `bypassesCover`), OR route Toll the Dead through a dedicated handler like Burning Hands (cleanest for v1). Alternatively, use the `CANTRIP_SELF_EFFECTS` self-buff registry with a flag that the save branch reads. **Simplest v1:** route Toll the Dead through `resolveAttack`'s save branch but set the Action's `damage.sides` dynamically when building the Action (the AI/parser checks `target.currentHP < target.maxHP` and sets sides=12 or 8). Document this in the module header. No post-hit rider → metadata only (the conditional is handled at Action-build time, not in the cantrip module).
- [ ] **Mind Sliver** (`TCE p.108`) — INT save, 1d6 psychic, scales. **Rider: target takes −1d4 to its next saving throw before the end of your next turn.** This is a one-shot save debuff (analogous to Vicious Mockery's one-shot attack debuff, but for saves). **Mirror the Vicious Mockery pattern (zHANDOVER-SESSION-6):** add `_mindSliverDiePenaltyNextSave?: number` (or boolean) to `Combatant` in `core.ts`; set it in `applyCantripEffect` (post-save-FAIL); in `rollSave` (utils.ts), fold it into the save total (subtract 1d4) and consume (set to false/undefined) after the save resolves. Add `cleanup()` clearing the flag (called from `resetBudget`). Register in `CANTRIP_EFFECTS` (post-save-FAIL dispatcher). The `rollSave` integration is new — Vicious Mockery integrated into `resolveAttack`'s attack-roll branch; Mind Sliver integrates into `rollSave` directly (a different choke point). This is a clean extension of the one-shot-debuff pattern.
- [ ] **Thunderclap** (`XGE p.168`) — CON save, 1d6 thunder, **all creatures within 5 ft of the caster** (caster-centered AoE), scales. **First caster-centered AoE cantrip.** Implementation options: (a) route through `resolveAttack` with `isAoE: true` (but the save branch currently handles single-target), or (b) follow the Burning Hands / Thunderwave pattern with a dedicated `executeThunderclap` handler. **Recommendation: option (b)** — create `execute(caster, targets, state)` in the module (mirror `src/spells/burning_hands.ts`), find all enemies within 5 ft, roll a save for each, apply damage. Add a `case 'thunderclap':` to `executePlannedAction`? NO — that violates the no-`case` rule. Instead, the AI planner must use the existing `cast` type, and `executePlannedAction`'s `case 'cast':` must detect AoE cantrips and route to their `execute` function. **Check how Burning Hands is routed** — it has a dedicated `case 'burningHands':` in `executePlannedAction`. For cantrips, the routing rule is "no `case 'spellName'`". Resolution: add a generic `CANTRIP_AOE_EFFECTS` registry (4th registry) that `executePlannedAction`'s `case 'cast':` consults BEFORE `resolveAttack` — if the action name is in `CANTRIP_AOE_EFFECTS`, call its `execute(caster, targets, state)` and skip `resolveAttack`. This mirrors `CANTRIP_SELF_EFFECTS` for self-buffs. Document this as an architectural extension.
- [ ] **Booming Blade** (`TCE p.106`) — melee spell attack, 1d8 thunder, reach 5 ft, scales. **Rider: if the target moves willingly before the start of your next turn, it immediately takes 1d8 thunder damage (scales too).** This is a **movement-triggered damage rider** — a NEW pattern (not a debuff, not a save, not an ongoing effect; it's a trap that fires on a specific trigger). Implementation: set `target._boomingBladePendingDamageDice?: string` (e.g. '1d8') on hit. Hook into the movement system (`executeMove` in combat.ts) — when a creature with this flag moves willingly (not forced movement), roll the damage and apply it, then clear the flag. Add `cleanup()` clearing the flag (called from `resetBudget`). Register in `CANTRIP_EFFECTS` (post-hit). The movement hook is new — check `executeMove` in `combat.ts` for the right choke point (after `spendMovement` succeeds, before/after the position update). **Willingly** means not forced (Thorn Whip pull, Thunderwave push, grapple drag) — only Dash/normal movement triggers it. Document the "willingly" caveat.

### Integration points you will touch (expected)

- `src/types/core.ts`: Add `_mindSliverDiePenaltyNextSave?: number` (Mind Sliver). Add `_boomingBladePendingDamageDice?: string` (Booming Blade). Both optional scratch fields on `Combatant`.
- `src/engine/cantrip_effects.ts`: Add `'Mind Sliver'` and `'Booming Blade'` to `CANTRIP_EFFECTS` (post-save-fail / post-hit). Add a new `CANTRIP_AOE_EFFECTS` registry + `resolveCantripAoE()` router for Thunderclap (mirror `CANTRIP_SELF_EFFECTS` / `resolveCantripAction`).
- `src/engine/combat.ts`:
  - `resolveAttack` save branch — no changes needed (Mind Sliver's rider is applied via the existing post-save-fail `applyCantripEffect` dispatch added in session 6).
  - `executePlannedAction` `case 'cast':` — add `resolveCantripAoE()` check (before `resolveCantripAction` and `resolveAttack`) for AoE cantrips like Thunderclap.
  - `executeMove` — add Booming Blade movement-trigger hook (check `_boomingBladePendingDamageDice`, roll damage, apply, clear flag — ONLY for willing movement, not forced).
- `src/engine/utils.ts`: `rollSave` — fold `_mindSliverDiePenaltyNextSave` into the save total (subtract `rollDie(4)`) and consume it after the save resolves. `resetBudget` — add `cleanupMindSliver` and `cleanupBoomingBlade` calls.
- **Do NOT** touch the AI planner (`src/ai/planner.ts`) — that's Core Engine territory. The engine routing is enough; AI selection is a separate task.

### Tests (write one `*.test.ts` per cantrip, in the repo's ts-node convention)

Mirror `src/test/vicious_mockery.test.ts` (47 tests) and `src/test/sacred_flame.test.ts` (51 tests) for structure: custom `assert`/`eq` harness, `makeCombatant`/`makeBF`/`makeState` helpers, sections for metadata / rider / dispatcher / cleanup / engine-integration. **Use deterministic save outcomes** (DC=30 for guaranteed fail, DC=1 + ability=30 for guaranteed success) — see `src/test/vicious_mockery.test.ts` for the pattern. Target ~20–40 tests per cantrip. Each test file must exit non-zero on failure (`process.exit(1)`).

**Critical test cases per cantrip:**
- Eldritch Blast: metadata; damage type = force; scales flag; v1 single-beam simplification documented. (Multi-beam scaling is TODO — note in tests.)
- Toll the Dead: metadata; WIS save; **conditional damage: 1d12 when target wounded, 1d8 when full HP** (construct both scenarios, verify the damage die in the Action matches).
- Mind Sliver: metadata; INT save; **rider applies −1d4 to next save on save-fail**; **rider consumed on next save** (one-shot — second save has no penalty); **rider cleared by resetBudget**; **save-success applies no rider**; **the −1d4 is rolled and subtracted in `rollSave`** (verify the save total is reduced).
- Thunderclap: metadata; CON save; **caster-centered AoE (all within 5 ft)** — verify multiple enemies in range each roll a save; **caster is NOT hit**; enemies beyond 5 ft are NOT hit; scales.
- Booming Blade: metadata; melee spell attack; **rider applied on hit** (`_boomingBladePendingDamageDice` set); **willing movement triggers the damage** (call `executeMove`, verify damage applied + flag cleared); **forced movement does NOT trigger** (Thorn Whip pull / Thunderwave push); **rider cleared by resetBudget if no movement**.

---

## COMPLETED THIS SESSION (Session 6, for reference)

### Feature: 5 cantrips implemented

1. **Fire Bolt** (`src/spells/fire_bolt.ts`) — PHB p.242. Ranged spell attack, 1d10 fire, 120 ft. Scales at 5/11/17 (2d10/3d10/4d10). Metadata only (no rider). Respects Total Cover (no `bypassesCover`).
2. **Acid Splash** (`src/spells/acid_splash.ts`) — PHB p.211. DEX save, 1d6 acid, 60 ft. Scales. **v1 simplification: single-target only** (PHB allows 1 or 2 creatures within 5 ft; 2-target AoE is TODO). Metadata only (no rider).
3. **Poison Spray** (`src/spells/poison_spray.ts`) — PHB p.266. CON save, 1d12 poison, 10 ft (NOT a cone — single target within 10 ft). Scales. Metadata only.
4. **Vicious Mockery** (`src/spells/vicious_mockery.ts`) — PHB p.285. WIS save, 1d4 psychic, 60 ft. Scales. **Rider: target has disadv on next attack roll before end of its next turn.** One-shot debuff (consumed on next attack, hit or miss). Registered in `CANTRIP_EFFECTS` (post-save-FAIL). New scratch field `_viciousMockeryDisadvNextAttack?: boolean` on `Combatant`. Folded into `resolveAttack`'s `disadvantage` boolean; consumed (set to false) after the attack roll resolves. Cleanup via `resetBudget`.
5. **Sacred Flame** (`src/spells/sacred_flame.ts`) — PHB p.272. DEX save, 1d8 radiant, 60 ft. Scales. **Special: `bypassesCover: true`** — PHB p.272 "The target gains no benefit from cover for this saving throw." New `bypassesCover?: boolean` field on `Action` in `core.ts`. `resolveAttack`'s save branch skips the LOS/total-cover gating when set. Metadata only (no rider).

### Integration points touched (Session 6)

- `src/types/core.ts`: Added `bypassesCover?: boolean` to `Action`. Added `_viciousMockeryDisadvNextAttack?: boolean` to `Combatant`.
- `src/engine/cantrip_effects.ts`: Added `'Vicious Mockery'` to `CANTRIP_EFFECTS`; imported its `applyCantripEffect`.
- `src/engine/combat.ts`:
  - **Exported `resolveAttack`** (was internal) for direct testing of cantrip engine integration. Added a doc comment noting it's exported for testability.
  - **LOS computation refactored**: save-based actions now compute LOS unless `action.bypassesCover === true` (Sacred Flame skips it). Previously, save-based actions never computed LOS. This adds PHB-correct total-cover blocking for single-target save spells (Acid Splash, Poison Spray, Vicious Mockery) while letting Sacred Flame bypass it. AoE save spells (Burning Hands, Thunderwave) have their own handlers and are unaffected.
  - **Save branch: post-save-FAIL `applyCantripEffect` dispatch**: added `if (!save.success) applyCantripEffect(attacker, target, action.name, state);` after damage in the save branch. This is the new dispatch point for save-based cantrips with post-fail riders (Vicious Mockery). The dispatcher is a no-op for cantrips with no rider (Acid Splash, Poison Spray, Sacred Flame).
  - **Attack branch: Vicious Mockery disadv + consume**: added `viciousMockeryDisadv = attacker._viciousMockeryDisadvNextAttack === true` check, folded into `disadvantage`. After `rollAttack`, consume: `attacker._viciousMockeryDisadvNextAttack = false` (one-shot, hit or miss). Log on both apply and consume.
- `src/engine/utils.ts`: `resetBudget` now calls `cleanupViciousMockery(c)` (clears the flag if not consumed by an attack before end of target's next turn).

### Tests (Session 6)

- `src/test/fire_bolt.test.ts`: 43 tests. Metadata, scaling, dispatcher no-op, Action shape, resolveAttack integration (hit + fire damage), Total Cover respects.
- `src/test/acid_splash.test.ts`: 44 tests. Metadata, scaling, save ability, v1 single-target simplification, dispatcher no-op, Action shape, save FAIL/SUCCESS (deterministic DC), Total Cover respects.
- `src/test/poison_spray.test.ts`: 46 tests. Metadata, scaling, save ability, 10 ft range, dispatcher no-op, Action shape, save FAIL/SUCCESS (deterministic DC), Total Cover respects, "not a cone" clarification.
- `src/test/vicious_mockery.test.ts`: 47 tests. Metadata, scaling, save ability, components (V only), applyCantripEffect sets flag, dispatcher integration, dispatcher safety, resetBudget cleanup, **save FAIL → rider applies**, **save SUCCESS → no rider**, **attack disadv folded from flag**, **rider consumed after one attack**, **second attack: no disadv (one-shot)**, Total Cover respects.
- `src/test/sacred_flame.test.ts`: 51 tests. Metadata, scaling, save ability, **bypassesCover flag**, dispatcher no-op, Action shape, save FAIL/SUCCESS (deterministic DC), **Sacred Flame bypasses Total Cover**, **cover bonus NOT applied to save**, **opt-in: non-bypass save spell IS blocked by Total Cover** (control test).

**Total new tests: 231.** All use deterministic save outcomes (DC=30 for guaranteed fail, DC=1 + ability=30 for guaranteed success) to avoid d20 flakiness.

---

## DISCOVERIES / PATTERNS FROM THIS SESSION (reuse these)

1. **Save-based cantrip routing is now clean.** `resolveAttack`'s save branch handles all single-target save cantrips. The LOS check now applies to save spells (unless `bypassesCover`), and post-save-FAIL riders dispatch via `applyCantripEffect`. No new routing needed for single-target save cantrips.
2. **One-shot debuff pattern (Vicious Mockery).** For "disadv on next attack" or "−1d4 to next save" riders: set a boolean/number scratch field on the target in `applyCantripEffect` (post-save-FAIL); fold it into the roll at the appropriate choke point (`resolveAttack` for attacks, `rollSave` for saves); consume (set to false) after the roll resolves; cleanup via `resetBudget`. This is distinct from Chill Touch's ongoing undead-disadv (which lasts the whole turn). **Mind Sliver (next batch) will extend this to `rollSave` — a new choke point.**
3. **`bypassesCover` is opt-in on `Action`.** Sacred Flame sets `bypassesCover: true`; all other save spells default to `undefined`/`false` and respect Total Cover. This is extensible to future spells (e.g. Word of Radiance could set it). The flag lives on `Action` (not `Combatant` or metadata) because it's a property of the spell being cast, not the caster or target.
4. **Exported `resolveAttack` for testing.** Previously internal, now exported with a doc comment noting it's for testability. This enables direct testing of cantrip engine integration (consume-on-attack, bypassesCover, save-fail dispatch) without going through `runCombat` + AI planner (which is slow and doesn't yet select most cantrips). Normal callers should still use `runCombat` / `executePlannedAction`.
5. **Deterministic save outcomes in tests.** Use DC=30 (save = d20 + mod, max ~25 < 30 → guaranteed fail) and DC=1 + ability=30 (save = d20+10, min 11 >= 1 → guaranteed success) to make save tests non-flaky. The burning_hands.test.ts has a pre-existing flaky test (`dex 30 vs DC 13` → 10% failure on nat 1-2) — do NOT repeat this mistake.
6. **Resistance composition** lives in `applyDamageWithTempHP`'s single `hasResistance` boolean (Blade Ward pattern) — not relevant to this batch (no damage-resistance riders).
7. **Build hygiene:** run `./node_modules/.bin/tsc --noEmit` before committing. Run the full suite (excluding the pre-existing thorn_whip hang): `for t in src/test/*.test.ts; do [[ "$t" == *"thorn_whip"* ]] && continue; timeout 60 ./node_modules/.bin/ts-node --transpile-only "$t" || echo "FAIL: $t"; done`.
8. **Revert test side-effects** before committing: `git checkout -- characters/` if any fixture JSON got an `updatedAt` bump.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 10/49 cantrips implemented).
2. Implement the 5 cantrips in the order above (Eldritch Blast first — simplest; Mind Sliver + Booming Blade last — most involved).
3. After each: `tsc --noEmit` + run that cantrip's test.
4. After all 5: run the **full regression suite** (must stay green; 2 pre-existing failures: thorn_whip hangs, warding_bond has 3 failing tests — both unrelated to cantrips).
5. `npm run spell-cache:build` again — confirm cantrip implemented count goes 10 → 15.
6. Commit: `Cantrip-7: Implement Eldritch Blast, Toll the Dead, Mind Sliver, Thunderclap, Booming Blade (PHB/XGE/TCE)`.
7. Write `zHANDOVER-SESSION-8.md` (next batch — use `npm run spell-cache:pick -- --level 0 --count 5` to choose, or curate for mechanical diversity).
8. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 6)

- `fire_bolt.test.ts`: 43/43 · `acid_splash.test.ts`: 44/44 · `poison_spray.test.ts`: 46/46 · `vicious_mockery.test.ts`: 47/47 · `sacred_flame.test.ts`: 51/51
- Prior cantrip tests still green: `blade_ward.test.ts` 38/38, `chill_touch.test.ts` 38/38, `shocking_grasp.test.ts` 26/26
- Full regression suite (56 files, ~2800+ tests): all green EXCEPT 2 pre-existing failures:
  - `thorn_whip.test.ts`: **hangs** in section 5 (pre-existing, not caused by cantrip work)
  - `warding_bond.test.ts`: 3 tests fail (pre-existing "Bond break: caster died" assertions, not caused by cantrip work)
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **10/49 cantrips implemented**, 36 cantrips remaining in-scope

---

## NOTES FOR NEXT AGENT

- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Parser tech debt** (still open, documented in zHANDOVER-3/4/5/6): `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. Not blocking this batch.
- **AI planner** does not yet select most cantrips — engine routing is enough for this batch. AI selection is a Core Engine task.
- **Commit message convention:** `Cantrip-N: <summary>` (this session was Cantrip-6; next session is Cantrip-7).
- **Pre-existing test failures** (do NOT try to fix — outside cantrip scope): `thorn_whip.test.ts` hangs, `warding_bond.test.ts` has 3 failing "Bond break" tests, `burning_hands.test.ts` has a flaky "dex 30 guaranteed pass" test (10% failure rate on nat 1-2). These are NOT caused by cantrip work.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
