# zHANDOVER-SESSION-14

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `<new>` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water (XGE/PHB/GGR) — FINAL cantrip batch, completes all 49 in-scope cantrips
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
  - `<new>` — Cantrip-13: Implement Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water (XGE/PHB/GGR) — FINAL cantrip batch, completes all 49 in-scope cantrips
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

- **The cantrip workstream is COMPLETE.** Sessions 1–13 implemented ALL 46 in-scope cantrips (excluding the 3 out-of-scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp). There are NO more cantrips to implement.
- **This handover (Session 14) is a PIVOT.** The next agent should choose ONE of the forward-compat subsystems documented across Sessions 7–13, OR coordinate with the Core Engine agent on AI planner cantrip selection.
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts` — now **FIVE registries** (Session 13 added `Control Flames`/`Dancing Lights`/`Druidcraft`/`Encode Thoughts`/`Mold Earth`/`Shape Water` to `CANTRIP_SELF_EFFECTS`):
  - `CANTRIP_EFFECTS` (13) — post-hit / post-save-fail riders: Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Vicious Mockery, Mind Sliver, Booming Blade, Frostbite, Sapping Sting, Lightning Lure, Green-Flame Blade, Infestation, Gust
  - `CANTRIP_ATTACK_ADVANTAGE` (1) — pre-roll advantage: Shocking Grasp
  - `CANTRIP_SELF_EFFECTS` (17) — non-attack self-buffs: Blade Ward, Shillelagh, True Strike, Resistance, Guidance, Friends, Minor Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message, Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water
  - `CANTRIP_AOE_EFFECTS` (3) — caster-centered AoE: Thunderclap, Sword Burst, Word of Radiance
  - `CANTRIP_TOUCH_EFFECTS` (3) — non-attack touch-effect on a single target: Spare the Dying, Light, Mending
  - (Primal Savagery + Magic Stone are metadata-only — no registry entry.)
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read **`zHANDOVER-SESSION-13.md`** (Session 13 patterns: the FINAL batch of 6 metadata-only flavor-log cantrips via `CANTRIP_SELF_EFFECTS` — Control Flames/Dancing Lights/Druidcraft/Encode Thoughts/Mold Earth/Shape Water. NO scratch fields, NO new Combatant fields, NO new registries. v1 simplifications documented via metadata flags. Session 13 achieved 4 "FIRST cantrip" milestones: FIRST S-only cantrip (Control Flames), FIRST concentration cantrip (Dancing Lights — `concentration: true` in metadata but v1 does NOT enforce concentration), FIRST GGR-source cantrip (Encode Thoughts — GGR p.47, 2018-11-20), FIRST 8-hour-duration cantrip (Encode Thoughts). DISCOVERED during Session 13: Gust is V+S per canon 5etools JSON `{"v":true,"s":true}`, NOT S-only as the Session 13 handover claimed — only 3 of the 4 XGE elemental-utility cantrips (Control Flames, Mold Earth, Shape Water) are S-only; Gust is V+S. The source comments in control_flames.ts/mold_earth.ts/shape_water.ts and shape_water.test.ts test 32 were corrected to reflect this.)
3. Read `zHANDOVER-SESSION-12.md` (Mage Hand/Prestidigitation/Thaumaturgy/Message's metadata-only flavor-log pattern via `CANTRIP_SELF_EFFECTS` mirroring Minor Illusion; Mending's `CANTRIP_TOUCH_EFFECTS` registration mirroring Light v1). These are the templates for the metadata-only pattern.
4. Read `zHANDOVER-SESSION-11.md` (Spare the Dying's `CANTRIP_TOUCH_EFFECTS` registry; Guidance's `_guidanceDieBonusNextAbilityCheck` scratch field — forward-compat for the future `rollAbilityCheck` choke point that DOES NOT YET EXIST; Friends's `_friendsAdvNextChaCheck` scratch field — mirror True Strike but for CHA checks).
5. Read `SPELL-CACHE.md` — it explains the cache + picker workflow.
6. Run `npm install` (deps: ts-node, typescript).
7. Run `npm run spell-cache:build` — confirm 46/49 cantrips implemented; 0 remaining in-scope (only 3 out-of-scope XPHB-only remain: Elementalism, Sorcerous Burst, Starry Wisp). The cantrip workstream is COMPLETE.

---

## GOALS THIS SESSION — PIVOT (cantrip workstream is COMPLETE)

There are NO more cantrips to implement. The next agent should choose ONE of the following forward-compat subsystems, OR coordinate with the Core Engine agent on AI planner cantrip selection.

### Option A: `rollAbilityCheck` choke point in `src/engine/utils.ts` (RECOMMENDED — lowest risk, highest value)

**Why:** Two cantrips (Guidance from Session 11, Friends from Session 11) set forward-compat scratch flags that are NEVER CONSUMED because the `rollAbilityCheck` choke point doesn't exist yet:
- `_guidanceDieBonusNextAbilityCheck?: number` (Guidance — ADD a d4 to the next ability check)
- `_friendsAdvNextChaCheck?: boolean` (Friends — advantage on the next CHA check)

These scratch flags are set in `applySelfEffect` and cleared at the start of the caster's NEXT turn via `cleanup()` called from `resetBudget`. The consuming choke point (`rollAbilityCheck`) is the missing piece.

**Implementation:** Mirror `rollSave`'s architecture in `src/engine/utils.ts`:
```typescript
export function rollAbilityCheck(
  combatant: Combatant,
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
  dc: number,
): { roll: number; total: number; success: boolean; details: string[] } {
  // 1. Roll d20
  // 2. Add ability modifier
  // 3. If combatant._guidanceDieBonusNextAbilityCheck is set, ADD 1d4 and consume the flag
  // 4. If ability === 'cha' AND combatant._friendsAdvNextChaCheck is set, roll with advantage and consume the flag
  // 5. Compare total to dc, return success/fail
}
```

**Tests:** Write `src/test/roll_ability_check.test.ts` mirroring `rollSave`'s test pattern. Verify:
- Guidance's +1d4 is consumed on the next ability check (any ability)
- Friends's advantage is consumed on the next CHA check only
- Both flags are cleared after consumption
- Both flags are cleared at the start of the caster's NEXT turn if not consumed

**Coordination:** This is cantrip-adjacent (consumes cantrip scratch flags) but touches `utils.ts` which is Core Engine territory. Coordinate with the Core Engine agent before modifying `utils.ts`. The Core Engine agent may already have a `rollAbilityCheck` in progress — check `HANDOVER-SESSION-*.md` for the latest Core Engine state.

### Option B: Persistent-buff subsystem for multi-effect cantrips

**Why:** 5 cantrips have "up to N effects active" caps that v1 ignores (all documented via `*MultiEffectTrackingV1Implemented: false` metadata flags):
- Prestidigitation (Session 12) — up to 3 non-instantaneous effects
- Thaumaturgy (Session 12) — up to 3 of its 1-minute effects
- Control Flames (Session 13) — up to 3 non-instantaneous effects
- Mold Earth (Session 13) — up to 2 non-instantaneous effects
- Shape Water (Session 13) — up to 2 non-instantaneous effects

**Implementation:** Add an `activeCantripEffects?: ActiveCantripEffect[]` field to `Combatant` (or a new `ActiveEffects` registry on `EngineState`). Each `ActiveCantripEffect` tracks: cantrip name, caster ID, effect type (chosen from the cantrip's effect list), expiry turn, target cell/point. The `applySelfEffect` handlers for these 5 cantrips would then push to this list (instead of just emitting a flavor log), and the cleanup would remove expired entries.

**Risk:** HIGH — this is a significant engine change that touches `Combatant` type, `resetBudget`, and all 5 cantrip modules. Coordinate with the Core Engine agent.

### Option C: Concentration subsystem

**Why:** Dancing Lights (Session 13) is the FIRST concentration cantrip (`concentration: true` in metadata), but v1 does NOT enforce concentration. The engine does not yet model:
- Concentration checks on damage taken (CON save vs DC 10 or half damage taken, whichever is higher — PHB p.203)
- Concentration disruption by conditions (e.g. incapacitated, petrified — PHB p.203)
- Voluntary ending of concentration (free action)

**Implementation:** Add a `concentration: { spellName: string; startTurn: number; durationRounds: number } | null` field tracking on `Combatant` (the field already exists as `concentration: null` per the type, but it's never populated). When a cantrip/spell with `concentration: true` is cast, set this field. On damage taken, trigger a CON save. On condition application, check if the condition breaks concentration.

**Risk:** HIGH — this is a Core Engine change that affects ALL concentration spells (not just cantrips). The Core Engine agent likely already has plans for this — check `HANDOVER-SESSION-*.md`. Do NOT implement without coordinating.

### Option D: AI planner cantrip selection in `src/ai/planner.ts` (Core Engine territory — coordinate)

**Why:** The AI planner does not yet select most cantrips. The engine routing (`resolveCantripAction`/`resolveCantripAoE`/`resolveCantripTouchEffect`) is enough for the cantrips to WORK when cast, but the AI doesn't know WHEN to cast them. This is a Core Engine task — the cantrip workstream agent should NOT touch `planner.ts` without coordinating.

**Coordination:** Read `HANDOVER-SESSION-*.md` for the latest Core Engine state. The Core Engine agent may already be working on cantrip selection — do NOT duplicate work.

### Option E: Parser tech debt (still open, documented in zHANDOVER-3/4/5/6/7/8/9/10/11/12/13)

**Why:** `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. `spellcastingMod` and `casterLevel` fields also exist but aren't populated by the parser. `isConstruct` does NOT exist yet (needed for Spare the Dying's canon type exclusion — currently a v1 simplification flag). Not blocking, but worth addressing if the Core Engine agent hasn't already.

---

## COMPLETED THIS SESSION (Session 13, for reference)

### Feature: 6 cantrips implemented (FINAL batch — cantrip workstream COMPLETE)

1. **Control Flames** (`src/spells/control_flames.ts`) — XGE p.152. 60 ft range, instant or 1 hour duration, **S only (NO V, NO M — canon 5etools JSON: `{"s":true}`)**. THIS IS THE FIRST S-ONLY CANTRIP IN THE WORKSTREAM. **Effect: choose nonmagical flame within range (5-ft cube); 1 of 4 effects (expand 5 ft, extinguish, double/halve light area or change color for 1 hr, shapes in flames for 1 hr).** Canon: up to 3 non-instantaneous effects active simultaneously. v1 simplification: metadata-only flavor log via `CANTRIP_SELF_EFFECTS` (mirror Prestidigitation). NO scratch fields. v1 simplification flags: `controlFlamesMultiEffectTrackingV1Implemented: false` AND `controlFlamesEffectChoiceV1Simplified: true` AND `controlFlamesDurationV1Simplified: true` AND `controlFlamesDismissalV1Implemented: false` AND `controlFlamesNonMagicalFlameRequirementV1Simplified: true` AND `controlFlamesRangeEnforcementV1Simplified: true`. Register in `CANTRIP_SELF_EFFECTS`.
2. **Dancing Lights** (`src/spells/dancing_lights.ts`) — PHB p.230. 120 ft range, 1 minute duration, **V+S+M (a bit of phosphorus or wychwood, or a glowworm — canon 5etools JSON: `{"v":true,"s":true,"m":"a bit of phosphorus or wychwood, or a glowworm"}`)**, **CONCENTRATION** (the FIRST concentration cantrip in the workstream — `concentration: true` in metadata, but v1 does NOT enforce concentration). **Effect: create up to 4 torch-sized lights (torches/lanterns/orbs) OR combine into 1 glowing Medium humanoid form; each sheds dim light 10-ft radius; bonus action moves lights up to 60 ft; lights must stay within 20 ft of each other; wink out if exceeds range.** v1 simplification: metadata-only flavor log via `CANTRIP_SELF_EFFECTS` (mirror Minor Illusion). NO scratch fields. v1 simplification flags: `dancingLightsPersistentLightsV1Implemented: false` AND `dancingLightsBonusActionMoveV1Implemented: false` AND `dancingLightsConcentrationV1Simplified: true` AND `dancingLightsLightRadiusIntegrationV1Implemented: false` AND `dancingLightsCombineFormV1Simplified: true` AND `dancingLightsRangeEnforcementV1Simplified: true` AND `dancingLightsProximityRequirementV1Simplified: true` AND `dancingLightsDismissalV1Implemented: false`. Register in `CANTRIP_SELF_EFFECTS`.
3. **Druidcraft** (`src/spells/druidcraft.ts`) — PHB p.236. 30 ft range, instant, **V+S (NO M — canon 5etools JSON: `{"v":true,"s":true}`)**. **Effect: whisper to spirits of nature; 1 of 4 effects (weather prediction 1 round, bloom flower/bud/seed, harmless sensory effect 5-ft cube, light/snuff candle/torch/campfire).** v1 simplification: metadata-only flavor log via `CANTRIP_SELF_EFFECTS` (mirror Prestidigitation/Thaumaturgy but nature-themed). NO scratch fields. v1 simplification flags: `druidcraftEffectChoiceV1Simplified: true` AND `druidcraftWeatherPredictionV1Implemented: false` AND `druidcraftPlantGrowthV1Implemented: false` AND `druidcraftDurationV1Simplified: true` AND `druidcraftRangeEnforcementV1Simplified: true`. Register in `CANTRIP_SELF_EFFECTS`.
4. **Encode Thoughts** (`src/spells/encode_thoughts.ts`) — GGR p.47. self range, 8 hour duration, **S only (NO V, NO M — canon 5etools JSON: `{"s":true}`)**. THIS IS THE FIRST GGR-SOURCE CANTRIP AND THE FIRST 8-HOUR-DURATION CANTRIP. **Effect: pull a memory/idea/message from your mind; transform into a tangible thought strand (Tiny, weightless, semisolid, like a ribbon); appears in unoccupied space within 5 ft; can be held/carried; cast while holding a strand to receive its contents; can transform thoughts read from others (e.g. detect thoughts) into a strand.** v1 simplification: metadata-only flavor log via `CANTRIP_SELF_EFFECTS` (mirror Minor Illusion). NO scratch fields. v1 simplification flags: `encodeThoughtsThoughtStrandV1Implemented: false` AND `encodeThoughtsThoughtReadingIntegrationV1Implemented: false` AND `encodeThoughtsStrandReceptionV1Implemented: false` AND `encodeThoughtsDurationV1Simplified: true` AND `encodeThoughtsRecastEndsPreviousV1Implemented: false` AND `encodeThoughtsRangeV1Simplified: true`. Register in `CANTRIP_SELF_EFFECTS`.
5. **Mold Earth** (`src/spells/mold_earth.ts`) — XGE p.162. 30 ft range, instant or 1 hour duration, **S only (NO V, NO M — canon 5etools JSON: `{"s":true}`)**. **Effect: choose dirt/stone within range (5-ft cube); 1 of 3 effects (excavate/move loose earth 5 ft, shapes/colors/words on dirt/stone for 1 hr, or difficult-terrain toggle for 1 hr).** Canon: up to 2 non-instantaneous effects active simultaneously. v1 simplification: metadata-only flavor log via `CANTRIP_SELF_EFFECTS` (mirror Control Flames). NO scratch fields. v1 simplification flags: `moldEarthMultiEffectTrackingV1Implemented: false` AND `moldEarthEffectChoiceV1Simplified: true` AND `moldEarthDifficultTerrainIntegrationV1Implemented: false` (the most mechanically significant v1 simplification in this batch — would double movement cost in affected cells) AND `moldEarthDurationV1Simplified: true` AND `moldEarthDismissalV1Implemented: false` AND `moldEarthExcavationV1Implemented: false` AND `moldEarthRangeEnforcementV1Simplified: true`. Register in `CANTRIP_SELF_EFFECTS`.
6. **Shape Water** (`src/spells/shape_water.ts`) — XGE p.164. 30 ft range, instant or 1 hour duration, **S only (NO V, NO M — canon 5etools JSON: `{"s":true}`)**. THIS IS THE FINAL CANTRIP IN THE WORKSTREAM. **Effect: choose water within range (5-ft cube); 1 of 4 effects (move/change flow 5 ft, form into simple shapes for 1 hr, change color/opacity for 1 hr, or freeze for 1 hr if no creatures in it).** Canon: up to 2 non-instantaneous effects active simultaneously. v1 simplification: metadata-only flavor log via `CANTRIP_SELF_EFFECTS` (mirror Control Flames/Mold Earth). NO scratch fields. v1 simplification flags: `shapeWaterMultiEffectTrackingV1Implemented: false` AND `shapeWaterEffectChoiceV1Simplified: true` AND `shapeWaterWaterFlowV1Implemented: false` AND `shapeWaterFreezeV1Implemented: false` AND `shapeWaterDurationV1Simplified: true` AND `shapeWaterDismissalV1Implemented: false` AND `shapeWaterRangeEnforcementV1Simplified: true`. Register in `CANTRIP_SELF_EFFECTS`.

### Integration points touched (Session 13)

- `src/types/core.ts`: NO new scratch fields needed. All 6 cantrips are metadata-only with no persistent state (mirror Minor Illusion / Mage Hand / Prestidigitation / Thaumaturgy / Message). All existing scratch fields from prior sessions are unaffected.
- `src/engine/cantrip_effects.ts`: Added `'Control Flames'`, `'Dancing Lights'`, `'Druidcraft'`, `'Encode Thoughts'`, `'Mold Earth'`, `'Shape Water'` to `CANTRIP_SELF_EFFECTS` (mirror Prestidigitation — flavor-only self-buffs that emit a single log event). Added 6 imports. Updated module header to list all 46 supported cantrips across 5 registries.
- `src/engine/combat.ts`: NO changes (all 6 cantrips auto-route via the existing `resolveCantripAction` dispatcher).
- `src/engine/utils.ts`: NO changes (all 6 cantrips have no-op cleanups — mirror Minor Illusion / Mage Hand / Prestidigitation / Thaumaturgy / Message).
- **Do NOT** touch the AI planner (`src/ai/planner.ts`) — that's Core Engine territory.

### Tests written (Session 13)

- `src/test/control_flames.test.ts`: 86/86
- `src/test/dancing_lights.test.ts`: 102/102
- `src/test/druidcraft.test.ts`: 95/95
- `src/test/encode_thoughts.test.ts`: 103/103
- `src/test/mold_earth.test.ts`: 106/106
- `src/test/shape_water.test.ts`: 118/118
- Total new tests: 610

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build` (confirm 46/49 cantrips implemented; 0 remaining in-scope — the cantrip workstream is COMPLETE).
2. Choose ONE of the pivot options (A/B/C/D/E) above. Option A (`rollAbilityCheck` choke point) is RECOMMENDED — lowest risk, highest value, consumes 2 existing forward-compat scratch flags (Guidance + Friends).
3. If choosing Option A: coordinate with the Core Engine agent before modifying `src/engine/utils.ts` (check `HANDOVER-SESSION-*.md` for the latest Core Engine state — they may already have a `rollAbilityCheck` in progress).
4. If choosing Option B/C: coordinate with the Core Engine agent — these are significant engine changes.
5. If choosing Option D/E: this is Core Engine territory — coordinate.
6. After implementing: `tsc --noEmit` + run the full regression suite (must stay green).
7. Commit with message format `Cantrip-14: <summary>` (or a new pivot-workstream prefix if the agent decides to rename — coordinate with the user).
8. Write `zHANDOVER-SESSION-15.md`.
9. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session — i.e. AFTER session 13)

- `control_flames.test.ts`: 86/86 · `dancing_lights.test.ts`: 102/102 · `druidcraft.test.ts`: 95/95 · `encode_thoughts.test.ts`: 103/103 · `mold_earth.test.ts`: 106/106 · `shape_water.test.ts`: 118/118
- Prior cantrip tests still green: `fire_bolt.test.ts` 43/43, `acid_splash.test.ts` 44/44, `poison_spray.test.ts` 46/46, `vicious_mockery.test.ts` 47/47, `sacred_flame.test.ts` 51/51, `blade_ward.test.ts` 38/38, `chill_touch.test.ts` 38/38, `shocking_grasp.test.ts` 26/26, `thorn_whip.test.ts` 11/11, `eldritch_blast.test.ts` 53/53, `toll_the_dead.test.ts` 61/61, `mind_sliver.test.ts` 48/48, `thunderclap.test.ts` 54/54, `booming_blade.test.ts` 218/218, `frostbite.test.ts` 57/57, `sword_burst.test.ts` 54/54, `sapping_sting.test.ts` 50/50, `lightning_lure.test.ts` 88/88, `green_flame_blade.test.ts` 209/209, `word_of_radiance.test.ts` 58/58, `produce_flame.test.ts` 52/52, `infestation.test.ts` 277/277, `shillelagh.test.ts` 60/60, `create_bonfire.test.ts` 99/99, `gust.test.ts` 74/74, `primal_savagery.test.ts` 57/57, `true_strike.test.ts` 49/49, `resistance.test.ts` 49/49, `magic_stone.test.ts` 61/61, `spare_the_dying.test.ts` 71/71, `guidance.test.ts` 52/52, `friends.test.ts` 53/53, `light.test.ts` 60/60, `minor_illusion.test.ts` 55/55, `mage_hand.test.ts` 62/62, `prestidigitation.test.ts` 59/59, `thaumaturgy.test.ts` 59/59, `mending.test.ts` 64/64, `message.test.ts` 60/60
- Full regression suite (93 files): ALL GREEN, 0 failures, 0 timeouts (even the 5 pre-existing flaky tests passed this run: combat/faerie_fire/burning_hands/arms_of_hadar/rage/healing_word)
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, **46/49 cantrips implemented**, 0 cantrips remaining in-scope (3 out-of-scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp)

---

## NOTES FOR NEXT AGENT

- **The cantrip workstream is COMPLETE.** All 46 in-scope cantrips are implemented. There are NO more cantrips to implement.
- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Parser tech debt** (still open, documented in zHANDOVER-3/4/5/6/7/8/9/10/11/12/13): `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. `spellcastingMod` and `casterLevel` fields also exist but aren't populated by the parser. `isConstruct` does NOT exist yet (needed for Spare the Dying's canon type exclusion — currently a v1 simplification flag). Not blocking.
- **AI planner** does not yet select most cantrips — engine routing is enough for v1. AI selection is a Core Engine task.
- **Commit message convention:** `Cantrip-N: <summary>` (Session 13 was Cantrip-13; Session 14 may pivot to a new workstream prefix if the agent chooses Option A/B/C — coordinate with the user).
- **Pre-existing flaky tests** (do NOT try to fix — outside cantrip scope, verified pre-existing): `combat.test.ts`, `faerie_fire.test.ts`, `burning_hands.test.ts`, `arms_of_hadar.test.ts`, `rage.test.ts`, `healing_word.test.ts` (transient timeout). These are d20-probabilistic or transient-load and NOT caused by cantrip work. All 6 passed in the Session 13 final regression run.
- **Architecture summary (5 cantrip registries, 46 cantrips total after Session 13 — COMPLETE):**
  - `CANTRIP_EFFECTS` (13) — post-hit / post-save-fail riders: Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Vicious Mockery, Mind Sliver, Booming Blade, Frostbite, Sapping Sting, Lightning Lure, Green-Flame Blade, Infestation, Gust
  - `CANTRIP_ATTACK_ADVANTAGE` (1) — pre-roll advantage: Shocking Grasp
  - `CANTRIP_SELF_EFFECTS` (17) — self-buffs: Blade Ward, Shillelagh, True Strike, Resistance, Guidance, Friends, Minor Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message, Control Flames, Dancing Lights, Druidcraft, Encode Thoughts, Mold Earth, Shape Water
  - `CANTRIP_AOE_EFFECTS` (3) — caster-centered AoE: Thunderclap, Sword Burst, Word of Radiance
  - `CANTRIP_TOUCH_EFFECTS` (3) — non-attack touch-effect on a single target: Spare the Dying, Light, Mending
  - (Primal Savagery + Magic Stone are metadata-only — no registry entry.)
  - **46 implemented cantrips total** (per `spell-cache:build` Level-0 count). The registry count (37 registered + 2 metadata-only = 39) is LESS than 46 because some cantrips are in multiple registries (Shocking Grasp is in both CANTRIP_EFFECTS and CANTRIP_ATTACK_ADVANTAGE) and the spell-cache count includes ALL implemented cantrips regardless of registry.
- **Exported for testability:** `resolveAttack` (Session 6), `executeMove` (Session 7), `rollRandomDirection` / `directionToDelta` / `isDestinationBlocked` / `applyRandomMove` (Session 9 — Infestation), `pushAway` / `canPushSize` (Session 10 — Gust), `resolveCantripTouchEffect` (Session 11). All have doc comments noting they're for direct testing of cantrip engine integration.
- **All `Combatant` scratch fields added across Sessions 7–13:** `_mindSliverDiePenaltyNextSave?: number` (Mind Sliver), `_viciousMockeryDisadvNextAttack?: boolean` (Vicious Mockery), `_frostbiteDisadvNextWeaponAttack?: boolean` (Frostbite), `_boomingBladePrimed?: boolean` (Booming Blade — note: the actual field is `_boomingBladePendingDamageDice?: string`), `_chillTouchNoHeal?: boolean` + `_chillTouchUndeadDisadv?: boolean` (Chill Touch — note: the actual field is `_chillTouchNoHealing?: boolean`), `_rayOfFrostSpeedReduction?: number` (Ray of Frost), `_thornWhipPullPending?: number` (Thorn Whip), `_infestationMovePending?: { dx, dy }` (Infestation), `_shockingGraspNoReaction?: boolean` (Shocking Grasp), `_sappingStingProneApplied?: boolean` (Sapping Sting — defensive, condition is via `addCondition`), `_lightningLurePullPending?: number` (Lightning Lure), `_greenFlameBladeSplashPending?: boolean` (Green-Flame Blade), `_gustPushPending?: number` (Gust), `_shillelaghActive?: boolean` (Shillelagh), `_trueStrikeAdvNextAttack?: boolean` (True Strike), `_resistanceDieBonusNextSave?: number` (Resistance), `_guidanceDieBonusNextAbilityCheck?: number` (Guidance — forward-compat for `rollAbilityCheck`), `_friendsAdvNextChaCheck?: boolean` (Friends — forward-compat for `rollAbilityCheck`), `_lightSourceActive?: boolean` (Light), `_isStabilized?: boolean` (Spare the Dying), `_mended?: boolean` (Mending). Optional with sensible defaults. **Session 13 added NO new scratch fields** (all 6 cantrips are metadata-only with no persistent state). **Sessions 14+ may add fields for the pivot subsystems** (e.g. `activeCantripEffects` for Option B, or `concentration` tracking for Option C).
- **CANTRIP_TOUCH_EFFECTS routing architecture (Spare the Dying + Light + Mending):** For non-attack, non-AoE, non-self-buff cantrips that target a single DOWNED ALLY or willing creature: use the `CANTRIP_TOUCH_EFFECTS` registry (handler signature `(caster, target, state) => boolean`). The dispatcher `resolveCantripTouchEffect(caster, target, actionName, state)` is consulted in `executePlannedAction`'s `case 'cast':` AFTER `resolveCantripAction` (self-buffs) and `resolveCantripAoE` (AoE), but BEFORE the target-null guard. CRITICAL: this routing MUST come BEFORE `if (!target || target.isDead || target.isUnconscious) break;` because Spare the Dying's target is UNCONSCIOUS.
- **Forward-compat scratch field architecture (Light + Mending):** Set a scratch flag on the TARGET (not the caster) in `applyTouchEffect` (CANTRIP_TOUCH_EFFECTS). v1 sets the flag but the consuming subsystem (computeLOS for Light / object-state for Mending) does NOT yet read it — documented via metadata flags.
- **Missing-choke-point scratch field architecture (Guidance + Friends — Option A pivot target):** Set a scratch flag on the CASTER in `applySelfEffect` (CANTRIP_SELF_EFFECTS). v1 sets the flag but does NOT consume it (the future `rollAbilityCheck` choke point doesn't exist yet). The flag is cleared at the start of the caster's NEXT turn via `cleanup()` called from `resetBudget` (v1 1-round simplification). **Future work (Option A): add `rollAbilityCheck(combatant, ability, dc)` to `utils.ts`** (mirror `rollSave`'s architecture — fold in `_guidanceDieBonusNextAbilityCheck` ADD + `_friendsAdvNextChaCheck` advantage, then consume).
- **Metadata-only flavor-log self-buff architecture (Minor Illusion + Mage Hand + Prestidigitation + Thaumaturgy + Message + Control Flames + Dancing Lights + Druidcraft + Encode Thoughts + Mold Earth + Shape Water — 11 cantrips total):** Provide `metadata` only + an `applySelfEffect(caster, state) => boolean` that emits a SINGLE log event. NO scratch fields. NO new Combatant fields. NO CANTRIP_EFFECTS/TOUCH/AoE entries. Register in `CANTRIP_SELF_EFFECTS`. cleanup is a no-op. v1 simplifications are documented via metadata flags. This is the simplest cantrip pattern — v1 is essentially a "flavor action."
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
  - **Session 13:** FIRST S-only cantrip (Control Flames — `{"s":true}` only), FIRST concentration cantrip (Dancing Lights — `concentration: true` in metadata, v1 does NOT enforce), FIRST GGR-source cantrip (Encode Thoughts — GGR p.47, 2018-11-20), FIRST 8-hour-duration cantrip (Encode Thoughts), FIRST evocation self-buff cantrip (Dancing Lights)
- **CANTRIP WORKSTREAM IS COMPLETE.** All 46 in-scope cantrips implemented. Session 14+ should pivot to forward-compat subsystems (Option A/B/C/D/E above).

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
