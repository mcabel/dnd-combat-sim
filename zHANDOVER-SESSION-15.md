# zHANDOVER-SESSION-15

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `<new>` — Cantrip-14: Implement `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot — consumes Guidance + Friends forward-compat scratch flags; cantrip workstream pivots from "implement cantrips" to "extend forward-compat subsystems")
  - `d5660dc` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water (XGE/PHB/GGR) — FINAL cantrip batch, completes all 49 in-scope cantrips
  - `6c185e9` — Cantrip-12: Implement Mage Hand, Prestidigitation, Thaumaturgy, Mending, Message (PHB)
  - `24d7d0d` — Cantrip-11: Implement Spare the Dying, Guidance, Friends, Light, Minor Illusion (PHB)
  - `6a7704f` — Cantrip-10: Implement Gust, Primal Savagery, True Strike, Resistance, Magic Stone (XGE/PHB)
  - `abf347d` — Cantrip-9: Implement Infestation, Word of Radiance, Create Bonfire, Produce Flame, Shillelagh (XGE/PHB)
  - `fe8cec1` — Cantrip-8: Implement Frostbite, Green-Flame Blade, Lightning Lure, Sword Burst, Sapping Sting (XGE/TCE/EGW)
  - `c4cfc11` — Cantrip-7: Implement Eldritch Blast, Toll the Dead, Mind Sliver, Thunderclap, Booming Blade (PHB/XGE/TCE)
  - `c975049` — Cantrip-6: Implement Fire Bolt, Acid Splash, Poison Spray, Vicious Mockery, Sacred Flame (PHB)
  - `bc4d033` — Cantrip-3/4/5: Recover lost sessions (Chill Touch + Blade Ward + handovers)
  - `f2f40a3` — Spell-cache: per-level cache + batch picker tooling
- Commits this session:
  - `<new>` — Cantrip-14: Implement `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot — consumes Guidance + Friends forward-compat scratch flags; cantrip workstream pivots from "implement cantrips" to "extend forward-compat subsystems")
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

- **The cantrip workstream is COMPLETE (cantrip implementation).** Sessions 1–13 implemented ALL 46 in-scope cantrips (excluding the 3 out-of-scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp). There are NO more cantrips to implement.
- **Session 14 PIVOTED to forward-compat subsystems.** The `rollAbilityCheck` choke point (Option A from Session 14's handover) is now IMPLEMENTED in `src/engine/utils.ts`. It consumes the two forward-compat scratch flags set by the Guidance and Friends cantrips:
  - `_guidanceDieBonusNextAbilityCheck?: number` (Guidance — ADD a d4 to the next ability check, any ability)
  - `_friendsAdvNextChaCheck?: boolean` (Friends — advantage on the next CHA check)
- **The cantrip architecture in `src/engine/cantrip_effects.ts` is UNCHANGED** — still FIVE registries (Session 13's final state):
  - `CANTRIP_EFFECTS` (13) — post-hit / post-save-fail riders
  - `CANTRIP_ATTACK_ADVANTAGE` (1) — pre-roll advantage: Shocking Grasp
  - `CANTRIP_SELF_EFFECTS` (17) — non-attack self-buffs (Guidance + Friends still here; their flags are now CONSUMED by `rollAbilityCheck`)
  - `CANTRIP_AOE_EFFECTS` (3) — caster-centered AoE
  - `CANTRIP_TOUCH_EFFECTS` (3) — non-attack touch-effect on a single target
  - (Primal Savagery + Magic Stone are metadata-only — no registry entry.)
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).
- **NEW CHOKE POINT:** `rollAbilityCheck(combatant, ability, dc, isProficient=false)` in `src/engine/utils.ts` (line ~242). Returns `{ roll, total, success, details }`. Folds in: Bardic Inspiration, Guidance (+1d4, any ability), Friends (advantage, CHA-only), Rage (advantage, STR-only), Poisoned (disadvantage), advantage-system entries (`querySelf` scope `'ability'` and `'ability:<ab>'`). v1 simplifications documented in the function's doc comment.

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-14.md`** (Session 14 patterns: the PIVOT — Option A `rollAbilityCheck` choke point. Documents 5 forward-compat options A/B/C/D/E; Session 14 chose A. Lists the 2 scratch flags consumed: `_guidanceDieBonusNextAbilityCheck` (Guidance) and `_friendsAdvNextChaCheck` (Friends). Includes a code template for the function signature.)
3. Read `zHANDOVER-SESSION-13.md` (the FINAL cantrip batch: Control Flames / Dancing Lights / Druidcraft / Encode Thoughts / Mold Earth / Shape Water. Confirms 5 cantrip registries, 46 implemented cantrips total).
4. Read `zHANDOVER-SESSION-11.md` (Guidance + Friends initial implementation — sets the scratch flags that Session 14 now consumes).
5. Read `SPELL-CACHE.md` — it explains the cache + picker workflow.
6. Run `npm install` (deps: ts-node, typescript).
7. Run `npm run spell-cache:build` — confirm 46/49 cantrips implemented; 0 remaining in-scope. The cantrip implementation workstream is COMPLETE.
8. **NEW for Session 15:** `grep -n "rollAbilityCheck" src/engine/utils.ts` — confirm the choke point exists (line ~242). If it does NOT exist, the previous session (14) failed to commit/push — re-implement per `zHANDOVER-SESSION-14.md` Option A.

---

## GOALS THIS SESSION — CONTINUE THE PIVOT (cantrip implementation is COMPLETE)

The cantrip workstream has PIVOTED. The `rollAbilityCheck` choke point (Option A) is DONE. The next agent should choose ONE of the remaining forward-compat subsystems from Session 14's handover, OR coordinate with the Core Engine agent on AI planner cantrip selection.

### Remaining pivot options (from zHANDOVER-SESSION-14.md)

- **Option B: Persistent-buff subsystem for multi-effect cantrips** — STILL OPEN. 5 cantrips have "up to N effects active" caps that v1 ignores:
  - Prestidigitation (Session 12) — up to 3 non-instantaneous effects
  - Thaumaturgy (Session 12) — up to 3 of its 1-minute effects
  - Control Flames (Session 13) — up to 3 non-instantaneous effects
  - Mold Earth (Session 13) — up to 2 non-instantaneous effects
  - Shape Water (Session 13) — up to 2 non-instantaneous effects
  - **Implementation:** Add an `activeCantripEffects?: ActiveCantripEffect[]` field to `Combatant` (or a new `ActiveEffects` registry on `EngineState`). Each `ActiveCantripEffect` tracks: cantrip name, caster ID, effect type (chosen from the cantrip's effect list), expiry turn, target cell/point. The `applySelfEffect` handlers for these 5 cantrips would then push to this list (instead of just emitting a flavor log), and the cleanup would remove expired entries.
  - **Risk:** HIGH — significant engine change that touches `Combatant` type, `resetBudget`, and all 5 cantrip modules. Coordinate with the Core Engine agent.

- **Option C: Concentration subsystem** — STILL OPEN. Dancing Lights (Session 13) is the FIRST concentration cantrip (`concentration: true` in metadata), but v1 does NOT enforce concentration. The engine does not yet model: concentration checks on damage taken (CON save vs DC 10 or half damage taken, whichever is higher — PHB p.203); concentration disruption by conditions (e.g. incapacitated, petrified); voluntary ending of concentration (free action). NOTE: `concentrationSaveDC(damageTaken)` ALREADY EXISTS in `utils.ts` (line ~526) — it's the consuming choke point that doesn't yet get called. The missing piece is the damage-taken hook that triggers the concentration check.
  - **Implementation:** Add a `concentration: { spellName: string; startTurn: number; durationRounds: number } | null` field tracking on `Combatant` (the field already exists as `concentration: null` per the type, but it's never populated). When a cantrip/spell with `concentration: true` is cast, set this field. On damage taken (in `applyDamage`), trigger a CON save vs `concentrationSaveDC(damage)`. On condition application, check if the condition breaks concentration (incapacitated, petrified — PHB p.203).
  - **Risk:** HIGH — Core Engine change that affects ALL concentration spells (not just cantrips). The Core Engine agent likely already has plans for this — check `HANDOVER-SESSION-*.md`. Do NOT implement without coordinating.

- **Option D: AI planner cantrip selection in `src/ai/planner.ts`** — STILL OPEN (Core Engine territory — coordinate). The engine routing (`resolveCantripAction`/`resolveCantripAoE`/`resolveCantripTouchEffect`) is enough for the cantrips to WORK when cast, but the AI doesn't know WHEN to cast them. Now that `rollAbilityCheck` exists (Session 14), the AI planner could also LEVERAGE ability-check cantrips (Guidance, Friends) — e.g. cast Guidance before attempting a contested ability check (grapple, shove). This is a Core Engine task — the cantrip workstream agent should NOT touch `planner.ts` without coordinating.
  - **Coordination:** Read `HANDOVER-SESSION-*.md` for the latest Core Engine state. The Core Engine agent may already be working on cantrip selection — do NOT duplicate work.

- **Option E: Parser tech debt** — STILL OPEN, documented in zHANDOVER-3/4/5/6/7/8/9/10/11/12/13. `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. `spellcastingMod` and `casterLevel` fields also exist but aren't populated by the parser. `isConstruct` does NOT exist yet (needed for Spare the Dying's canon type exclusion — currently a v1 simplification flag). Not blocking, but worth addressing if the Core Engine agent hasn't already.

### NEW pivot option suggested for Session 15 (built on Session 14's `rollAbilityCheck`):

- **Option F: Illusion-disbelief Investigation check via `rollAbilityCheck`** — NEW. Now that `rollAbilityCheck` exists (Session 14), Minor Illusion's `illusionMechanicsV1Implemented: false` flag could be partially lifted: the INT (Investigation) check to disbelieve could use `rollAbilityCheck` directly. The remaining missing piece is the illusion-subsystem state (which illusion is in which cell, which creature has examined it, etc.) — that's still a forward-compat TODO. This is a LOW-RISK, MEDIUM-VALUE option: the choke point now exists, so the Investigation check is just `rollAbilityCheck(examiner, 'int', casterSpellSaveDC)`. The state-tracking (which illusions exist, who's examined them) is the harder part. Coordinate with the Core Engine agent on whether to model illusion-state.
  - **Risk:** MEDIUM — touches `minor_illusion.ts` (add illusion-state tracking + an examine-action handler) and possibly `computeLOS` (for illusion-as-cover). The Core Engine agent may already be working on illusions — coordinate.

---

## COMPLETED THIS SESSION (Session 14, for reference)

### Feature: `rollAbilityCheck` choke point in `src/engine/utils.ts` (Option A pivot — DONE)

1. **`rollAbilityCheck` function** (`src/engine/utils.ts`, line ~242) — Mirrors `rollSave`'s architecture. Returns `{ roll, total, success, details: string[] }`. Folds in:
   - d20 (with advantage/disadvantage from conditions + advantage-system entries)
   - Ability modifier (`abilityMod(score)` — shared with `rollSave`)
   - Proficiency bonus (`profBonusByCR(cr)` if `isProficient` — shared with `rollSave`)
   - **Bardic Inspiration** (PHB p.54 — ADD `rollDie(die)`, consumed; applies to attack rolls, ability checks, AND saves — `consumeBardicInspiration` shared with `rollSave`/`resolveAttack`)
   - **Guidance** (PHB p.248 — ADD `rollDie(_guidanceDieBonusNextAbilityCheck)`, one-shot consume; ANY ability — str/dex/con/int/wis/cha)
   - **Friends** (PHB p.244 — advantage on the next CHA check, one-shot consume; CHA-only)
   - **Rage** (PHB p.48 — advantage on STR checks; flat unconditional, mirror `rollSave`'s STR-save advantage)
   - **Poisoned** (PHB Appendix A — disadvantage on ability checks; RAW — NOT on saves, though `rollSave` models it for saves too as a known v1 simplification)
   - **Advantage-system entries** via `querySelf` (scope `'ability'` and `'ability:<ab>'` — set via `adv_system.grantSelf`)
   - NO auto-fail on nat 1 / NO auto-success on nat 20 (PHB p.7 — ability checks have no critical-fail/critical-success rule; only attack rolls PHB p.194 and death saves PHB p.197 do).
   - The `details: string[]` array is a human-readable breakdown of each component (advantage source, d20 roll, ability mod, prof, BI, Guidance, total, dc, success/fail) — useful for combat-log rendering and debugging.
   - **v1 simplifications** (documented in the function's doc comment): does NOT model exhaustion (PHB p.291 — disadv on ability checks; exhaustion isn't tracked in the conditions Set); does NOT model every condition's ability-check interaction (only poisoned + rage are folded in); does NOT auto-tick advantage-system entries (caller responsibility, mirror `rollSave`).

2. **Metadata flags flipped** (forward-compat flags now reflect the implemented integration):
   - `src/spells/guidance.ts`: `guidanceAbilityCheckIntegrationV1Implemented: false → true` (line ~152). Doc comments updated throughout the module (header, metadata flag doc, `applySelfEffect` doc, `cleanup` doc) to reflect that the choke point now EXISTS.
   - `src/spells/friends.ts`: `friendsAbilityCheckIntegrationV1Implemented: false → true` (line ~174). Doc comments updated throughout the module similarly.
   - `src/types/core.ts`: scratch-field doc comments for `_guidanceDieBonusNextAbilityCheck` (line ~624) and `_friendsAdvNextChaCheck` (line ~654) updated to reflect that the choke point now EXISTS and the flags are CONSUMED.
   - `src/engine/utils.ts`: `resetBudget` cleanup comments for `cleanupGuidance` (line ~488) and `cleanupFriends` (line ~497) updated to reflect that `rollAbilityCheck` is the consuming choke point and cleanup is now a SAFETY NET (not the only clearing mechanism).
   - `src/engine/cantrip_effects.ts`: 2 comment lines for Guidance + Friends (lines ~17–18) updated to say "consumed by rollAbilityCheck" (was "future rollAbilityCheck integration").
   - `src/spells/minor_illusion.ts`: 2 comment blocks updated to reflect that `rollAbilityCheck` now EXISTS (the Investigation check to disbelieve is still out of scope — it requires illusion-subsystem state that v1 doesn't model — but the CHOKE POINT is no longer the blocker).

3. **Existing test assertions updated** (test 5c/5d flipped to expect `true`; test 11 reframed):
   - `src/test/guidance.test.ts`: test 5c now asserts `guidanceAbilityCheckIntegrationV1Implemented === true`. Test 11 reframed from "v1 does NOT consume the flag" to "flag is NOT consumed by any function other than rollAbilityCheck" (the flag is now consumed by `rollAbilityCheck`, but NOT by `rollSave`/`resolveAttack`/other functions; cleanup is a safety net). Header doc comment updated.
   - `src/test/friends.test.ts`: test 5d now asserts `friendsAbilityCheckIntegrationV1Implemented === true`. Test 11 reframed similarly. Header doc comment updated.

4. **New test file** (`src/test/roll_ability_check.test.ts`, 96 tests): Comprehensive coverage mirroring `rollSave`'s test pattern (specifically `resistance.test.ts`'s rollSave-integration tests). 20 sections:
   - 1. function exists + returns the right shape (`{ roll, total, success, details }`)
   - 2. basic d20 + ability mod (DC-impossible & DC-trivial)
   - 3. proficiency bonus folds in when `isProficient=true`
   - 4. success vs fail vs DC boundary (`total >= dc → success`)
   - 5. NO auto-fail on nat 1 / NO auto-success on nat 20 (PHB p.7) — 200-trial consistency check
   - 6. Guidance integration — +1d4 ADDed (any ability), one-shot consume
   - 7. Guidance one-shot — second check has NO bonus
   - 8. Guidance applies to ANY ability (str/dex/con/int/wis/cha — 6 sub-tests)
   - 9. Friends integration — advantage on CHA check, one-shot consume (400-trial avg > 12)
   - 10. Friends is CHA-only — flag NOT consumed by non-CHA checks (5 sub-tests)
   - 11. Friends + Guidance both consumed on the same CHA check
   - 12. Bardic Inspiration folds in (+die, consumed)
   - 13. Rage → advantage on STR checks (mirror `rollSave`, 400-trial avg > 12)
   - 14. Rage does NOT grant advantage on DEX/CON/INT/WIS/CHA checks (5 sub-tests, 200-trial avg < 12)
   - 15. Poisoned → disadvantage on ability checks (RAW — PHB App. A, 400-trial avg < 9)
   - 16. Advantage-system entries (`querySelf 'ability:str'` and `'ability'`) fold in
   - 17. Advantage + disadvantage cancel out (PHB p.173) — single roll (400-trial avg in 9..12); Friends flag STILL consumed even when advantage cancelled
   - 18. Both flags clear at start of caster's NEXT turn (`resetBudget` integration)
   - 19. `details` array contains the expected components (d20, ability mod, prof, total, dc, success/fail, Guidance, Friends advantage + consumed)
   - 20. mirror `rollSave` architecture (same choke-point pattern — `rollSave` consumes `_resistanceDieBonusNextSave`, `rollAbilityCheck` consumes `_guidanceDieBonusNextAbilityCheck`; neither touches the other's flag; cleanup functions clear respective flags; `abilityMod` + `profBonusByCR` are shared helpers)

### Integration points touched (Session 14)

- `src/engine/utils.ts`: Added `rollAbilityCheck` function (~100 lines including doc comment). Updated 2 `resetBudget` cleanup comments (Guidance + Friends) to reflect that the choke point now exists.
- `src/spells/guidance.ts`: Flipped `guidanceAbilityCheckIntegrationV1Implemented: false → true`. Updated 4 doc-comment blocks (module header, ability-check-bonus integration block, metadata flag doc, `applySelfEffect` doc, `cleanup` doc). Updated the cast log message (was "ability-check integration not yet implemented"; now "consumed by rollAbilityCheck").
- `src/spells/friends.ts`: Flipped `friendsAbilityCheckIntegrationV1Implemented: false → true`. Updated 4 doc-comment blocks similarly. Updated the cast log message (was "CHA-check integration not yet implemented"; now "consumed by rollAbilityCheck").
- `src/types/core.ts`: Updated 2 scratch-field doc-comment blocks (`_guidanceDieBonusNextAbilityCheck`, `_friendsAdvNextChaCheck`) to reflect that the choke point now EXISTS and the flags are CONSUMED.
- `src/engine/cantrip_effects.ts`: Updated 2 comment lines for Guidance + Friends in the module header.
- `src/spells/minor_illusion.ts`: Updated 2 comment blocks (module header + `illusionMechanicsV1Implemented` flag doc) to reflect that `rollAbilityCheck` now EXISTS (the Investigation check to disbelieve is still out of scope — requires illusion-subsystem state).
- `src/test/guidance.test.ts`: Updated test 5c assertion (now expects `true`). Reframed test 11 (now "flag is NOT consumed by any function other than rollAbilityCheck"). Updated header doc comment.
- `src/test/friends.test.ts`: Updated test 5d assertion (now expects `true`). Reframed test 11 similarly. Updated header doc comment.
- `src/test/roll_ability_check.test.ts`: NEW file, 96 tests.
- `src/engine/combat.ts`: NO changes (the new `rollAbilityCheck` is not yet wired into any combat action — it's available as a utility for future use; the AI planner / future spell modules can call it directly).
- `src/ai/planner.ts`: NO changes (Core Engine territory — coordinate before touching).
- **Do NOT** touch the AI planner (`src/ai/planner.ts`) — that's Core Engine territory.

### Tests written (Session 14)

- `src/test/roll_ability_check.test.ts`: 96/96
- Total new tests: 96

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 46/49 cantrips implemented; 0 remaining in-scope — the cantrip implementation workstream is COMPLETE).
2. **Verify Session 14's work landed:** `grep -n "export function rollAbilityCheck" src/engine/utils.ts` — should return line ~242. If it does NOT, the previous session (14) failed to commit/push — re-implement per `zHANDOVER-SESSION-14.md` Option A.
3. Choose ONE of the remaining pivot options (B/C/D/E/F) above. **Option F is NEW** (built on Session 14's `rollAbilityCheck` — partially lift Minor Illusion's `illusionMechanicsV1Implemented: false` flag by wiring the Investigation check to disbelieve via `rollAbilityCheck`).
4. If choosing Option B/C: coordinate with the Core Engine agent — these are significant engine changes.
5. If choosing Option D/E/F: this is Core Engine territory — coordinate.
6. After implementing: `tsc --noEmit` + run the full regression suite (must stay green).
7. Commit with message format `Cantrip-15: <summary>` (continuing the pivot-workstream prefix from Session 14).
8. Write `zHANDOVER-SESSION-16.md`.
9. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 14)

- `roll_ability_check.test.ts`: 96/96 (NEW)
- `guidance.test.ts`: 52/52 (test 5c flipped to expect `true`; test 11 reframed)
- `friends.test.ts`: 53/53 (test 5d flipped to expect `true`; test 11 reframed)
- Prior cantrip tests still green: `fire_bolt.test.ts` 43/43, `acid_splash.test.ts` 44/44, `poison_spray.test.ts` 46/46, `vicious_mockery.test.ts` 47/47, `sacred_flame.test.ts` 51/51, `blade_ward.test.ts` 38/38, `chill_touch.test.ts` 38/38, `shocking_grasp.test.ts` 26/26, `thorn_whip.test.ts` 11/11, `eldritch_blast.test.ts` 53/53, `toll_the_dead.test.ts` 61/61, `mind_sliver.test.ts` 48/48, `thunderclap.test.ts` 54/54, `booming_blade.test.ts` 218/218, `frostbite.test.ts` 57/57, `sword_burst.test.ts` 54/54, `sapping_sting.test.ts` 50/50, `lightning_lure.test.ts` 88/88, `green_flame_blade.test.ts` 209/209, `word_of_radiance.test.ts` 58/58, `produce_flame.test.ts` 52/52, `infestation.test.ts` 277/277, `shillelagh.test.ts` 60/60, `create_bonfire.test.ts` 99/99, `gust.test.ts` 74/74, `primal_savagery.test.ts` 57/57, `true_strike.test.ts` 49/49, `resistance.test.ts` 49/49, `magic_stone.test.ts` 61/61, `spare_the_dying.test.ts` 71/71, `light.test.ts` 60/60, `minor_illusion.test.ts` 55/55, `mage_hand.test.ts` 62/62, `prestidigitation.test.ts` 59/59, `thaumaturgy.test.ts` 59/59, `mending.test.ts` 64/64, `message.test.ts` 60/60, `control_flames.test.ts` 86/86, `dancing_lights.test.ts` 102/102, `druidcraft.test.ts` 95/95, `encode_thoughts.test.ts` 103/103, `mold_earth.test.ts` 106/106, `shape_water.test.ts` 118/118
- Full regression suite (94 files): ALL GREEN, 0 persistent failures. **NEW flaky test identified this session:** `mechanics.test.ts` — d20-probabilistic grapple-contest boundary test ("STR 30 vs STR 8: grapple wins >14/20 runs — won 14/20"). Failed 1 of 13 runs locally. **UNRELATED to Session 14's `rollAbilityCheck` work** — `mechanics.test.ts` imports `rollGrappleContest` (a separate function in `utils.ts`, line ~1160), NOT `rollAbilityCheck` (line ~242). Add to the pre-existing-flaky-tests list alongside `combat/faerie_fire/burning_hands/arms_of_hadar/rage/healing_word`.
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **46/49 cantrips implemented**, 0 cantrips remaining in-scope (3 out-of-scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp)

---

## NOTES FOR NEXT AGENT

- **The cantrip implementation workstream is COMPLETE.** All 46 in-scope cantrips are implemented. There are NO more cantrips to implement.
- **The `rollAbilityCheck` choke point (Option A) is COMPLETE.** It consumes the Guidance + Friends forward-compat scratch flags. The metadata flags `guidanceAbilityCheckIntegrationV1Implemented` and `friendsAbilityCheckIntegrationV1Implemented` are now `true`.
- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Parser tech debt** (still open, documented in zHANDOVER-3/4/5/6/7/8/9/10/11/12/13/14): `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. `spellcastingMod` and `casterLevel` fields also exist but aren't populated by the parser. `isConstruct` does NOT exist yet (needed for Spare the Dying's canon type exclusion — currently a v1 simplification flag). Not blocking.
- **AI planner** does not yet select most cantrips — engine routing is enough for v1. AI selection is a Core Engine task. NOW that `rollAbilityCheck` exists, the AI planner COULD also leverage ability-check cantrips (Guidance, Friends) — e.g. cast Guidance before attempting a contested ability check (grapple, shove). This is a Core Engine task — coordinate.
- **Commit message convention:** `Cantrip-N: <summary>` (Session 14 was `Cantrip-14: Implement rollAbilityCheck choke point...`; Session 15 should continue with `Cantrip-15: <summary>` for whichever pivot option is chosen).
- **Pre-existing flaky tests** (do NOT try to fix — outside cantrip scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout). **NEW this session:** `mechanics.test.ts` (d20-probabilistic grapple-contest boundary — "STR 30 vs STR 8: grapple wins >14/20 runs — won 14/20"; failed 1/13 runs locally; UNRELATED to `rollAbilityCheck`). These are d20-probabilistic or transient-load and NOT caused by cantrip work.
- **Architecture summary (5 cantrip registries, 46 cantrips total — UNCHANGED from Session 13):**
  - `CANTRIP_EFFECTS` (13) — post-hit / post-save-fail riders: Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Vicious Mockery, Mind Sliver, Booming Blade, Frostbite, Sapping Sting, Lightning Lure, Green-Flame Blade, Infestation, Gust
  - `CANTRIP_ATTACK_ADVANTAGE` (1) — pre-roll advantage: Shocking Grasp
  - `CANTRIP_SELF_EFFECTS` (17) — self-buffs: Blade Ward, Shillelagh, True Strike, Resistance, Guidance, Friends, Minor Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message, Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water
  - `CANTRIP_AOE_EFFECTS` (3) — caster-centered AoE: Thunderclap, Sword Burst, Word of Radiance
  - `CANTRIP_TOUCH_EFFECTS` (3) — non-attack touch-effect on a single target: Spare the Dying, Light, Mending
  - (Primal Savagery + Magic Stone are metadata-only — no registry entry.)
  - **46 implemented cantrips total** (per `spell-cache:build` Level-0 count). The registry count (37 registered + 2 metadata-only = 39) is LESS than 46 because some cantrips are in multiple registries (Shocking Grasp is in both CANTRIP_EFFECTS and CANTRIP_ATTACK_ADVANTAGE) and the spell-cache count includes ALL implemented cantrips regardless of registry.
- **Exported for testability:** `resolveAttack` (Session 6), `executeMove` (Session 7), `rollRandomDirection` / `directionToDelta` / `isDestinationBlocked` / `applyRandomMove` (Session 9 — Infestation), `pushAway` / `canPushSize` (Session 10 — Gust), `resolveCantripTouchEffect` (Session 11), **`rollAbilityCheck` (Session 14 — NEW)** — all have doc comments noting they're for direct testing of cantrip engine integration.
- **All `Combatant` scratch fields added across Sessions 7–14:** `_mindSliverDiePenaltyNextSave?: number` (Mind Sliver), `_viciousMockeryDisadvNextAttack?: boolean` (Vicious Mockery), `_frostbiteDisadvNextWeaponAttack?: boolean` (Frostbite), `_boomingBladePrimed?: boolean` (Booming Blade — note: the actual field is `_boomingBladePendingDamageDice?: string`), `_chillTouchNoHeal?: boolean` + `_chillTouchUndeadDisadv?: boolean` (Chill Touch — note: the actual field is `_chillTouchNoHealing?: boolean`), `_rayOfFrostSpeedReduction?: number` (Ray of Frost), `_thornWhipPullPending?: number` (Thorn Whip), `_infestationMovePending?: { dx, dy }` (Infestation), `_shockingGraspNoReaction?: boolean` (Shocking Grasp), `_sappingStingProneApplied?: boolean` (Sapping Sting — defensive, condition is via `addCondition`), `_lightningLurePullPending?: number` (Lightning Lure), `_greenFlameBladeSplashPending?: boolean` (Green-Flame Blade), `_gustPushPending?: number` (Gust), `_shillelaghActive?: boolean` (Shillelagh), `_trueStrikeAdvNextAttack?: boolean` (True Strike), `_resistanceDieBonusNextSave?: number` (Resistance — consumed by `rollSave`), `_guidanceDieBonusNextAbilityCheck?: number` (Guidance — **NOW CONSUMED by `rollAbilityCheck` as of Session 14**), `_friendsAdvNextChaCheck?: boolean` (Friends — **NOW CONSUMED by `rollAbilityCheck` as of Session 14**), `_lightSourceActive?: boolean` (Light), `_isStabilized?: boolean` (Spare the Dying), `_mended?: boolean` (Mending). Optional with sensible defaults. **Session 14 added NO new scratch fields** (the pivot is a consuming choke point, not a new flag).
- **CANTRIP_TOUCH_EFFECTS routing architecture (Spare the Dying + Light + Mending):** For non-attack, non-AoE, non-self-buff cantrips that target a single DOWNED ALLY or willing creature: use the `CANTRIP_TOUCH_EFFECTS` registry (handler signature `(caster, target, state) => boolean`). The dispatcher `resolveCantripTouchEffect(caster, target, actionName, state)` is consulted in `executePlannedAction`'s `case 'cast':` AFTER `resolveCantripAction` (self-buffs) and `resolveCantripAoE` (AoE), but BEFORE the target-null guard. CRITICAL: this routing MUST come BEFORE `if (!target || target.isDead || target.isUnconscious) break;` because Spare the Dying's target is UNCONSCIOUS.
- **Forward-compat scratch field architecture (Light + Mending):** Set a scratch flag on the TARGET (not the caster) in `applyTouchEffect` (CANTRIP_TOUCH_EFFECTS). v1 sets the flag but the consuming subsystem (computeLOS for Light / object-state for Mending) does NOT yet read it — documented via metadata flags. **UNCHANGED in Session 14.**
- **Missing-choke-point scratch field architecture (Guidance + Friends — Session 14 CLOSED THE GAP):** Set a scratch flag on the CASTER in `applySelfEffect` (CANTRIP_SELF_EFFECTS). **Session 14 added the consuming `rollAbilityCheck` choke point in `utils.ts`** — the flag is now CONSUMED on the next ability check (any ability for Guidance; CHA-only for Friends). The flag is cleared at the start of the caster's NEXT turn via `cleanup()` called from `resetBudget` as a SAFETY NET (only fires if the caster makes no ability check before their next turn — v1 1-round simplification). The metadata flags `guidanceAbilityCheckIntegrationV1Implemented` and `friendsAbilityCheckIntegrationV1Implemented` are now `true`. **The remaining v1 simplifications for Guidance are concentration (1-round vs canon 1-minute concentration) and touch-ally (self-only vs canon any willing creature).** **The remaining v1 simplifications for Friends are concentration (1-round vs canon 1-minute concentration), target-agnostic (next CHA check regardless of target vs canon "directed at one creature"), and hostility-backlash (skipped vs canon hostility-on-end).**
- **Metadata-only flavor-log self-buff architecture (Minor Illusion + Mage Hand + Prestidigitation + Thaumaturgy + Message + Control Flames + Dancing Lights + Druidcraft + Encode Thoughts + Mold Earth + Shape Water — 11 cantrips total):** Provide `metadata` only + an `applySelfEffect(caster, state) => boolean` that emits a SINGLE log event. NO scratch fields. NO new Combatant fields. NO CANTRIP_EFFECTS/TOUCH/AoE entries. Register in `CANTRIP_SELF_EFFECTS`. cleanup is a no-op. v1 simplifications are documented via metadata flags. This is the simplest cantrip pattern — v1 is essentially a "flavor action." **UNCHANGED in Session 14.** (Minor Illusion's `illusionMechanicsV1Implemented: false` flag is STILL `false` — the Investigation check to disbelieve could now use `rollAbilityCheck` per Option F, but the illusion-subsystem state is still missing. See Option F above.)
- **`rollAbilityCheck` architecture (Session 14 — NEW):** Mirrors `rollSave`'s architecture. Takes `(combatant, ability, dc, isProficient=false)`, returns `{ roll, total, success, details: string[] }`. Folds in: Bardic Inspiration, Guidance (+1d4, any ability, one-shot consume), Friends (advantage, CHA-only, one-shot consume), Rage (advantage, STR-only), Poisoned (disadvantage), advantage-system entries (`querySelf` scope `'ability'` and `'ability:<ab>'`). NO nat-1/nat-20 auto rule (PHB p.7). v1 simplifications: does NOT model exhaustion; does NOT model every condition's ability-check interaction (only poisoned + rage); does NOT auto-tick advantage-system entries (caller responsibility). NOT YET WIRED INTO any combat action — it's available as a utility for future use (the AI planner / future spell modules / illusion-disbelief Investigation check can call it directly). The `details` array is a human-readable breakdown useful for combat-log rendering and debugging.
- **FIRST cantrip milestones (cumulative, for the next agent's reference):**
  - Session 7: FIRST post-save-FAIL rider (Mind Sliver)
  - Session 7: FIRST caster-centered AoE cantrip (Thunderclap)
  - Session 7: FIRST conditional damage cantrip (Toll the Dead)
  - Session 8: FIRST splash-damage cantrip (Green-Flame Blade)
  - Session 8: FIRST prone-inflicting cantrip (Sapping Sting)
  - Session 8: FIRST conditional-damage-null cantrip (Lightning Lure)
  - Session 9: FIRST random-direction forced-movement cantrip (Infestation)
  - Session 9: FIRST forward-compat-scratch-flag cantrip (Shillelagh)
  - Session 10: FIRST push-AWAY forced-movement cantrip (Gust)
  - Session 11: FIRST heal-adjacent cantrip (Spare the Dying)
  - Session 11: FIRST ability-check-bonus cantrip (Guidance)
  - Session 11: FIRST CHA-check-advantage cantrip (Friends)
  - Session 12: FIRST non-action casting-time cantrip (Mending — canon 1 MINUTE, v1 simplified to 1 action)
  - Session 13: FIRST S-only cantrip (Control Flames — `{"s":true}` only), FIRST concentration cantrip (Dancing Lights — `concentration: true` in metadata, v1 does NOT enforce), FIRST GGR-source cantrip (Encode Thoughts — GGR p.47, 2018-11-20), FIRST 8-hour-duration cantrip (Encode Thoughts), FIRST evocation self-buff cantrip (Dancing Lights)
  - **Session 14:** FIRST cantrip-workstream pivot (Option A — `rollAbilityCheck` choke point). FIRST consuming-choke-point for forward-compat scratch flags (Guidance + Friends flags were SET in Session 11 but NEVER CONSUMED until Session 14). FIRST `details: string[]` return-shape in a `utils.ts` d20-roll function (richer than `rollSave`'s `{ roll, total, success }` — useful for combat-log rendering). FIRST canon-RAW poisoned-disadvantage implementation (PHB Appendix A — poisoned imposes disadvantage on attack rolls AND ability checks; `rollSave` models it for saves too as a known v1 simplification, but `rollAbilityCheck` follows RAW).
- **CANTRIP IMPLEMENTATION WORKSTREAM IS COMPLETE.** All 46 in-scope cantrips implemented. Session 14 PIVOTED to forward-compat subsystems (Option A `rollAbilityCheck` is DONE). Session 15+ should continue the pivot (Options B/C/D/E/F above) OR coordinate with the Core Engine agent on AI planner cantrip selection.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
