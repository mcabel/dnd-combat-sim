# TEAMGOALS.md — Cross-Workstream Coordination

> **Purpose:** Single source of truth for tasks and architectural decisions that
> cross workstream boundaries (Core Engine / Cantrip-z / Sheet). Per AGENTS.md,
> each workstream owns its own files; this file is the coordination layer that
> prevents duplication, merge conflicts, and missed dependencies.
>
> **Authority order** (matches ROADMAP.md):
> 1. Code (current repo state)
> 2. Latest uploaded handover (`zHANDOVER-SESSION-*` / `HANDOVER-SESSION-*` / `SHEET-HANDOVER-*`)
> 3. `TEAMGOALS.md` (this file)
> 4. `TASK.md` / `ROADMAP.md`
>
> **Maintenance rule:** Any agent may add a new section to this file when they
> discover a cross-workstream dependency. Use the section template at the bottom.
> Do NOT delete another workstream's section — edit only your own, and only to
> mark status changes (`OPEN` → `IN PROGRESS` → `DONE`).

---

## PENDING REVIEW

> Seeded by TG-012 (see below) — check this log at the START of every
> session, before reading your own TASK.md. Action the item or reply
> `ACKNOWLEDGED — reviewing, ETA <N>` on the same line. Remove the line once
> the underlying TG entry is actioned.

- TG-006 **ACKNOWLEDGED — Core Engine session 46** (commit below).
  Core Engine sign-off: **Phase 1 is APPROVED.** Cantrip-z may proceed with
  all Phase 1 LOW-risk sub-phases immediately: optional type fields on
  `Combatant`/`Battlefield`, new files under `src/summons/` and
  `src/spells/summon_*.ts`, new `'summonSpell'` `PlannedAction` type. Do NOT
  touch `runCombat`/`combat.ts` without a separate RFC comment in this file
  first — that still requires explicit Core Engine sign-off per the TG-006
  coordination protocol. Remove this line once Phase 1 is complete.

---

## CROSS-WORKSTREAM TASKS

These tasks touch files owned by MORE THAN ONE workstream. They cannot be
completed by a single agent without coordination.

### TG-001: Persistent-buff subsystem for multi-effect cantrips (Option B)

- **Status:** OPEN
- **Owners:** Cantrip-z (driving) + Core Engine (must review `Combatant` type
  change + `resetBudget` impact)
- **Source:** `zHANDOVER-SESSION-15.md` Option B; originally proposed in
  `zHandoversOld/zHANDOVER-SESSION-14.md`.
- **Summary:** 5 cantrips have "up to N effects active" caps that v1 ignores:
  Prestidigitation (3), Thaumaturgy (3), Control Flames (3), Mold Earth (2),
  Shape Water (2). Each `applySelfEffect` currently emits a flavor log only.
- **Implementation plan:**
  - Add `activeCantripEffects?: ActiveCantripEffect[]` field to `Combatant`
    (Core Engine owns `src/types/core.ts`).
  - Each `ActiveCantripEffect` tracks: cantrip name, caster ID, effect type,
    expiry turn, target cell/point.
  - The 5 cantrip `applySelfEffect` handlers push to this list (Cantrip-z owns
    `src/spells/<cantrip>.ts`).
  - `resetBudget` in `src/engine/utils.ts` (Core Engine) removes expired
    entries.
- **Risk:** HIGH — touches `Combatant` type, `resetBudget`, and all 5 cantrip
  modules. Both agents must agree on the shape of `ActiveCantripEffect` before
  implementation starts.
- **Coordination protocol:**
  1. Cantrip-z drafts an RFC (3-5 lines) describing the `ActiveCantripEffect`
     shape and posts it as a new section in this file under "RFCs".
  2. Core Engine reviews and approves / proposes changes.
  3. Core Engine adds the field to `Combatant` and the cleanup hook in
     `resetBudget` in a single commit.
  4. Cantrip-z then wires the 5 cantrip handlers in a follow-up commit.

### TG-002: Concentration subsystem (Option C)

- **Status:** DONE (Session 34, z-workstream)
- **Owners:** Core Engine (driving) + Cantrip-z (Dancing Lights is the only
  concentration cantrip)
- **Source:** `zHANDOVER-SESSION-15.md` Option C; `concentrationSaveDC` already
  exists in `src/engine/utils.ts` (line ~526) but is never called.
- **Summary:** v1 does NOT enforce concentration. Need: damage-taken hook that
  triggers a CON save vs `concentrationSaveDC(damageTaken)`; condition
  disruption (incapacitated, petrified); voluntary ending (free action).
- **Implementation plan:**
  - Core Engine adds a damage-taken hook in `applyDamage` (or
    `applyDamageWithTempHP`) that calls `concentrationSaveDC` and rolls a CON
    save.
  - Core Engine populates `Combatant.concentration` when a spell with
    `concentration: true` is cast (currently `null`).
  - Cantrip-z updates `dancing_lights.ts` to call `startConcentration` (mirror
    Bless / Entangle / Faerie Fire pattern) — currently it does NOT.
- **Risk:** HIGH — Core Engine change affects ALL concentration spells (not
  just cantrips). The Core Engine agent likely already has plans for this.
- **Coordination protocol:** Core Engine announces in its next
  `HANDOVER-SESSION-*.md` that it is picking up TG-002; Cantrip-z then updates
  Dancing Lights to match the new `startConcentration` signature.
- **Resolution (Session 34):** The concentration enforcement pipeline was
  ALREADY implemented in earlier sessions (5 damage sites in `combat.ts`
  calling `rollConcentrationSave` + `removeEffectsFromCaster` + `processFallDamage`),
  but 40 spell metadata flags (`xxxConcentrationEnforcementV1Implemented: false`)
  and 22 corresponding test assertions still marked it as "not implemented".
  Session 34 closed the gap:
  - Verified the end-to-end pipeline via a NEW integration test
    `src/test/concentration_enforcement.test.ts` (34 assertions covering all
    5 damage sites, DC computation, effect cleanup, summon despawn).
  - Fixed a gap at site E (line 4985, moving-zone damage): added the missing
    `processFallDamage(state)` call so Reverse Gravity / Fly / Levitate
    concentration breaks triggered by moving zones (Flaming Sphere, Moonbeam)
    now correctly process fall damage (matches the other 4 sites).
  - Flipped all 40 metadata flags from `false` → `true` in spell files
    (with updated `// TG-002 DONE (Session 34)` comment).
  - Updated all 22 test assertions from `false` → `true` (label text:
    "concentration enforcement NOW implemented (Session 34 TG-002)").
  - All baseline tests still pass (concentration_ai, dispel_magic, mechanics,
    reaction_registry, shield_reaction, absorb_elements, hellish_rebuke,
    counterspell, feather_fall, silvery_barbs, engine, combat, plus all 22
    flipped spells, plus summon/zone tests for reverse_gravity, watery_sphere,
    spirit_guardians, flaming_sphere, moonbeam, spike_growth, summon_beast,
    conjure_animals, witch_bolt, hex, bless).
  - v1 simplifications (War Caster / Resilient feats NOT modelled) are still
    documented in `rollConcentrationSave`'s comment — those would be a
    separate task if ever needed.

### TG-003: AI planner cantrip selection (Option D)

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/ai/planner.ts`)
- **Source:** `zHANDOVER-SESSION-15.md` Option D.
- **Summary:** Engine routing (`resolveCantripAction` / `resolveCantripAoE` /
  `resolveCantripTouchEffect`) makes cantrips WORK when cast, but the AI doesn't
  know WHEN to cast them. Most cantrips never appear in the AI's plan.
- **Sub-tasks:**
  - Offensive cantrips (Shocking Grasp, Booming Blade, Frostbite, Lightning
    Lure, Green-Flame Blade, Sapping Sting, Infestation, Gust) need a planner
    branch — similar to the existing Guiding Bolt / Dissonant Whispers branch.
  - Utility cantrips (Minor Illusion, Mage Hand, Prestidigitation, Thaumaturgy,
    Message, Control Flames, Mold Earth, Shape Water, Druidcraft, Encode
    Thoughts, Dancing Lights) are out of combat scope — no AI needed.
  - Ability-check cantrips (Guidance, Friends) now have a consumer
    (`rollAbilityCheck`); the planner COULD cast Guidance before a grapple/shove
    attempt. This is a stretch goal — the engine routes grapple/shove via
    `rollGrappleContest` (NOT `rollAbilityCheck`), so wiring would require
    refactoring `rollGrappleContest` to call `rollAbilityCheck`.
- **Risk:** MEDIUM — pure planner change, no engine impact.
- **Coordination protocol:** Core Engine owns this. Cantrip-z will NOT touch
  `planner.ts`.

### TG-004: Parser tech debt (Option E)

- **Status:** IN PROGRESS — session 46: `isUndead`, `isConstruct`, `hasMetalArmor`, `spellcastingMod`, `casterLevel` all populated by `monsterToCombatant`. `isConstruct` added to `Combatant` type. 14/14 bestiary smoke-tests pass.
- **Owners:** Core Engine (driving — owns `src/parser/*`)
- **Source:** `zHANDOVER-SESSION-15.md` Option E; documented in
  zHANDOVER-3/4/5/6/7/8/9/10/11/12/13/14/15.
- **Summary:** Several `Combatant` fields exist but aren't populated by the
  parser:
  - `hasMetalArmor` (Shocking Grasp advantage pre-roll check).
  - `isUndead` (Chill Touch, Healing Word, Cure Wounds — currently a stub).
  - `isConstruct` (does NOT exist yet — needed for Spare the Dying's canon type
    exclusion; currently a v1 simplification flag).
  - `spellcastingMod` (spells use WIS by default — wrong for Wizards (INT),
    Sorcerers/Bards (CHA), Warlocks (CHA)).
  - `casterLevel` (cantrip scaling — currently uses CR as a proxy).
- **Risk:** LOW — additive parser changes; no engine impact.
- **Coordination protocol:** Core Engine owns this. Cantrip-z and Sheet agents
  will consume the fields once they're populated.

### TG-005: Illusion-disbelief Investigation check (Option F)

- **Status:** OPEN
- **Owners:** Cantrip-z (driving — owns `src/spells/minor_illusion.ts`) +
  Core Engine (must review illusion-state + LOS interaction)
- **Source:** `zHANDOVER-SESSION-15.md` Option F; built on Session 14's
  `rollAbilityCheck` choke point.
- **Summary:** Now that `rollAbilityCheck` exists, the Investigation check to
  disbelieve a Minor Illusion could use it directly. The harder part is
  illusion-subsystem state (which illusion is in which cell, who's examined it).
- **Implementation plan:**
  - Cantrip-z adds an ` illusions?: IllusionState[]` field on `Battlefield`
    (Core Engine owns `src/types/core.ts`).
  - Minor Illusion's `applySelfEffect` pushes a new illusion into the array
    instead of just emitting a flavor log.
  - A new "examine" action (or a free-action hook in `planTurn`) lets a creature
    spend an action to make an INT (Investigation) check via
    `rollAbilityCheck(examiner, 'int', casterSpellSaveDC)`.
  - On success, the examiner learns the illusion is false; the illusion remains
    for others.
  - LOS: `computeLOS` in `src/engine/los.ts` (Core Engine) may need to treat
    illusions as cover until disbelieved — coordinate.
- **Risk:** MEDIUM — touches `minor_illusion.ts`, possibly `computeLOS`, adds
  state to `Battlefield`.
- **Coordination protocol:** Cantrip-z drafts an RFC for the `IllusionState`
  shape; Core Engine reviews.

### TG-006: Summon / Conjure subsystem (Session 19 — bulk-deferred blockers)

- **Status:** OPEN — **see `docs/TG-006-SUMMON-PLAN.md` for full research + 4-phase plan (Session 21)**
- **Owners:** Core Engine (driving — owns `src/engine/summons.ts` + `src/types/core.ts` summon-state shape) + Cantrip-z (consumes the subsystem in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 109 blocker spells identified); Session 21 deep-research pass produced `docs/TG-006-SUMMON-PLAN.md`
- **Summary:** v1 has PARTIAL summon infrastructure (`src/summons/registry.ts` + `spawner.ts` + `mount.ts` — 684 lines, 9 SUMMON_REGISTRY entries, 51/51 passing tests) but NO mid-combat summon insertion, NO concentration-break despawn, and NO spell modules wired to it. **43** in-scope spells (re-categorized from original 38 — `Illusory Script`, `Programmed Illusion`, `Leomund's Secret Chest`, `Drawmij's Instant Summons`, `Conjure Constructs` were missed in Session 19's regex). Of these 43: 12 TCE `Summon *` (LOW risk), 7 PHB `Conjure *` (MEDIUM risk), 3 Find Familiar/Steed (LOW risk) are implementable by Cantrip-z in 4-6 sessions. The remaining 19 (Animate Dead, Create Undead, Magic Jar, Simulacrum, True Polymorph, Glyph of Warding, etc.) need bespoke subsystems — defer to Core Engine.
- **Re-categorization note (Session 21, clarified Session 36):** `Conjure Barrage` (L3) and `Conjure Volley` (L5) are AoE damage spells (not summons) and are NOT blocked by TG-006. They appear only in `src/characters/class_spell_lists.ts` (Ranger list) and have NO spell module yet — if implemented, they would go in `_generic_registry.ts` as damage spells. The earlier "should be moved to the generic registry immediately" note was premature: they were never in the summon blocker list to begin with.
- **Existing infrastructure (do NOT rebuild):** `SUMMON_REGISTRY`, `spawnSummon()`, `issueVerbalCommand()`, mount system (`mount.ts`), `runCombat` reads `bf.pendingCommands` (line 2332). See `docs/TG-006-SUMMON-PLAN.md` §"Existing infrastructure" for full list.
- **Missing infrastructure (must build):** `isSummon`/`summonerId`/`summonSpellName` fields on `Combatant`; `pendingInitiativeInserts` on `Battlefield`; `'summonSpell'` PlannedAction type; `case 'summonSpell':` branch in `combat.ts`; mid-turn initiative-insert hook in `runCombat`; concentration-break despawn extension to `removeEffectsFromCaster`; CR-based creature picker for Conjure spells; 12 TCE stat blocks (hardcoded, not in bestiary).
- **Implementation plan (4 phases):**
  - **Phase 1 (2-3 sessions, LOW risk):** Infrastructure + 12 TCE `Summon *` spells with hardcoded stat blocks. Vertical slice: Summon Beast (L2) + Summon Fey (L3) + Summon Undead (L3) in Session 22.
  - **Phase 2 (1-2 sessions, MEDIUM risk):** 7 PHB `Conjure *` spells with bestiary CR-based picker. (Conjure Barrage / Conjure Volley are NOT in scope — they are AoE damage spells, not summons, and have no spell module yet.)
  - **Phase 3 (1 session, LOW risk):** Find Familiar (L1), Find Steed (L2), Find Greater Steed (L4) — reuses existing `spawnSummon`.
  - **Phase 4 (DEFER):** 19 remaining spells (Animate Dead, Create Undead, Magic Jar, Simulacrum, True Polymorph, Shapechange, Glyph of Warding, Symbol, Programmed Illusion, Illusory Script, Demiplane, Leomund's Secret Chest, Drawmij's Instant Summons, Planar Ally, Planar Binding, Gate, Infernal Calling, Create Magen, Clone) — each needs bespoke subsystem. Split into individual TG entries under TG-011 or new TG-012..TG-030.
- **Risk:** LOW for Phase 1/3, MEDIUM for Phase 2, HIGH for Phase 4 (deferred). All type/engine changes are additive (optional fields, new case branch, new helper function) — no breakage to existing spells.
- **Coordination protocol:** Post an RFC in TEAMGOALS.md before touching `combat.ts` `runCombat` loop — give Core Engine 1 session to object. See `docs/TG-006-SUMMON-PLAN.md` §"Cross-Workstream Touchpoints" for the full file-by-file checklist.
- **Blocked spells (43 — original 38 + 5 missed in Session 19):**
  - **Level 1 (2):** Find Familiar (PHB), Illusory Script (PHB) [missed in S19].
  - **Level 2 (2):** Find Steed (PHB), Summon Beast (TCE).
  - **Level 3 (7):** Animate Dead (PHB), Conjure Animals (PHB), Conjure Constructs (FRHoF) [missed in S19], Glyph of Warding (PHB), Summon Fey (TCE), Summon Lesser Demons (XGE), Summon Shadowspawn (TCE), Summon Undead (TCE). (Conjure Barrage is an AoE damage spell — NOT a summon, NOT blocked by TG-006.)
  - **Level 4 (7):** Conjure Minor Elementals (PHB), Conjure Woodland Beings (PHB), Find Greater Steed (XGE), Leomund's Secret Chest (PHB) [missed in S19], Summon Aberration (TCE), Summon Construct (TCE), Summon Elemental (TCE), Summon Greater Demon (XGE).
  - **Level 5 (5):** Conjure Elemental (PHB), Infernal Calling (XGE), Planar Binding (PHB), Summon Celestial (TCE), Summon Draconic Spirit (FTD). (Conjure Volley is an AoE damage spell — NOT a summon, NOT blocked by TG-006.)
  - **Level 6 (5):** Conjure Fey (PHB), Create Undead (PHB), Drawmij's Instant Summons (PHB), Magic Jar (PHB), Planar Ally (PHB), Programmed Illusion (PHB) [missed in S19], Summon Fiend (TCE).
  - **Level 7 (4):** Conjure Celestial (PHB), Create Magen (IDRotF), Simulacrum (PHB), Symbol (PHB).
  - **Level 8 (2):** Clone (PHB), Demiplane (PHB).
  - **Level 9 (4):** Gate (PHB), Shapechange (PHB), True Polymorph (PHB).

### TG-007: Wall subsystem (Session 19 — bulk-deferred blockers)

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/engine/los.ts` + `Battlefield.obstacles`) + Cantrip-z (consumes in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 12 wall spells identified)
- **Summary:** v1 has no wall subsystem. Walls require a "shape on the grid" model (line / cylinder / sphere / cube), block-LOS / block-movement flags, and persistent damage riders. 12 in-scope wall spells from levels 3–9 are blocked on this subsystem.
- **Implementation plan:**
  - Extend `Obstacle` interface in `src/types/core.ts` with `spellName?: string`, `damageType?: DamageType`, `damageDice?: { count, sides }`, `saveDC?: number`, `saveAbility?: AbilityScore`.
  - Core Engine adds a start-of-turn wall-damage hook in `runCombat` (parallel to `damage_zone`).
  - Cantrip-z wires each Wall spell to push an `Obstacle` with the appropriate shape.
- **Risk:** HIGH — walls interact with LOS, cover, and movement simultaneously.
- **Coordination protocol:** Core Engine designs the shape API (line vs cylinder vs cube); Cantrip-z wires spell modules.
- **Blocked spells (12):**
  - **Level 3 (3):** Wall of Sand (XGE), Wall of Water (XGE), Wind Wall (PHB).
  - **Level 4 (1):** Wall of Fire (PHB).
  - **Level 5 (3):** Wall of Force (PHB), Wall of Light (XGE), Wall of Stone (PHB).
  - **Level 6 (2):** Wall of Ice (PHB), Wall of Thorns (PHB).
  - **Level 9 (1):** Prismatic Wall (PHB).

### TG-008: Reaction spell subsystem (Session 19 — bulk-deferred blockers)

- **Status:** DONE (Session 33 + Session 34, z-workstream)
- **Owners:** Core Engine (driving — owns `src/engine/combat.ts` reaction window) + Cantrip-z (consumes in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 5 reaction spells identified)
- **Summary:** v1 has NO reaction subsystem beyond pre-set reactions in TurnPlan. Several classic spells are reaction-cast (triggered by an incoming attack / spell / fall). 5 in-scope spells blocked.
- **Implementation plan:**
  - Core Engine adds a `triggerReaction(actor, event)` hook in `resolveAttack` / `castSpell` paths.
  - Reaction spells register a trigger condition (incoming-attack / incoming-spell / falling).
  - When the trigger fires, the engine invokes the spell's `execute` if a slot is available.
- **Risk:** MEDIUM — additive hook; no engine disruption.
- **Coordination protocol:** Core Engine announces the trigger API; Cantrip-z wires spell modules.
- **Resolution (Session 33):** Implemented the full reaction subsystem:
  - `ReactionTrigger` discriminated union + `ReactionOutcome` type in `src/types/core.ts`
  - `ReactionSpellDescriptor` interface + `REACTION_SPELLS` registry in `src/spells/_reaction_registry.ts`
  - `triggerReactions(state, reactor, trigger)` helper in `src/engine/combat.ts` — iterates the registry, checks preconditions (reaction budget, slot, spell known, alive/conscious), fires the first matching spell
  - 4 trigger points wired in `resolveAttack` (incoming_attack_hit for Shield/Silvery Barbs, incoming_damage at 3 sites for Absorb Elements/Hellish Rebuke), `executePlannedAction` (incoming_spell for Counterspell), and `processFallDamage` (falling for Feather Fall)
  - Absorb Elements rider consumption in the standard attack damage branch
  - Cleanup wired in `resetBudget` (utils.ts) for Absorb Elements resistance
  - 6 reaction spells implemented: Shield (reworked to trigger-aware), Absorb Elements, Hellish Rebuke, Silvery Barbs, Counterspell, Feather Fall
  - 285 new test assertions across 7 test files (reaction_registry, shield_reaction, absorb_elements, hellish_rebuke, counterspell, feather_fall, silvery_barbs)
  - All baseline tests still pass (cure_wounds, healing_spells, healing_word, engine, ai, resources, scenario, combat, shield_simple, shield_of_faith, invisibility, thunderous_smite, booming_blade, green_flame_blade, conjure_fey, dispel_magic, etc.)
- **Resolution (Session 34):** Closed the 7th in-scope spell:
  - Implemented Protection from Energy (PHB p.266) as a regular concentration
    buff spell (L3 abjuration, touch, 10 min concentration, resistance to one
    damage type: acid/cold/fire/lightning/thunder). NOT a true reaction — the
    Session 19 categorization was a stretch.
  - New file `src/spells/protection_from_energy.ts` (~225 lines): metadata,
    `pickTarget`, `pickDamageType`, `shouldCast`, `execute`,
    `executeWithTarget`, `cleanup`.
  - Wired into the generic spell registry (`_generic_registry.ts`) so the AI
    planner can auto-cast it.
  - Added `_undoEffect` case for 'Protection from Energy' in
    `src/engine/spell_effects.ts` — when concentration breaks, removes the
    resistance from `target.resistances` (reads `payload.damageType` to know
    which type to remove; only the type we added is removed — innate
    resistance to other types is preserved).
  - New test `src/test/protection_from_energy.test.ts` (52 assertions):
    metadata, pickTarget priority, pickDamageType AI, shouldCast
    preconditions, execute mechanics, damage halving, concentration-break
    cleanup, generic-registry end-to-end dispatch.
  - All baseline tests still pass.
- **Blocked spells (5):**
  - **Level 1 (3):** Absorb Elements (XGE) ✅, Shield (PHB) ✅, Feather Fall (PHB) ✅.
  - **Level 1 (1):** Hellish Rebuke (XGE) ✅.
  - **Level 1 (1):** Silvery Barbs (SCC) ✅.
  - **Level 3 (1):** Counterspell (PHB) ✅.
  - **Level 3 (1):** Protection from Energy (PHB) ✅ (Session 34 — implemented
    as a regular concentration buff spell, NOT a reaction; the Session 19
    categorization as a reaction was a stretch).

### TG-009: Antimagic / Dispel subsystem (Session 19 — bulk-deferred blockers)

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/engine/spell_effects.ts` `removeEffectsFromCaster`) + Cantrip-z (consumes in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 3 antimagic spells identified)
- **Summary:** v1 has no spell-effect-suppression subsystem. Dispel Magic, Dispel Evil and Good, and Antimagic Field need to enumerate active effects on a target and remove them (Dispel Magic: ability-check gating; Antimagic Field: area suppress ALL magic; Dispel Evil and Good: target specific effect categories).
- **Implementation plan:**
  - Core Engine adds a `dispelEffects(target, levelThreshold)` function in `spell_effects.ts`.
  - Antimagic Field requires an "is in antimagic field?" check at every spell-cast site.
  - Cantrip-z wires Dispel Magic / Dispel Evil and Good / Antimagic Field spell modules.
- **Risk:** MEDIUM — Dispel Magic is straightforward; Antimagic Field is invasive (every cast site).
- **Coordination protocol:** Core Engine designs the dispel API.
- **Blocked spells (3):**
  - **Level 3 (1):** Dispel Magic (PHB).
  - **Level 5 (1):** Dispel Evil and Good (PHB).
  - **Level 8 (1):** Antimagic Field (PHB).

### TG-010: computeLOS / vision-blocking subsystem (Session 19 — bulk-deferred blockers)

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/engine/los.ts` `computeLOS`) + Cantrip-z (consumes in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 18 vision-blocking spells identified)
- **Summary:** v1's `computeLOS` does not query any "is the target obscured by magical darkness / fog / invisibility?" state. Darkness, Fog Cloud, Greater Invisibility, Arcane Eye, Clairvoyance, Scrying, True Seeing, etc. all need this extension. Forward-compat flags already exist for See Invisibility / Darkvision — extending `computeLOS` to consume them is the canonical implementation path.
- **Implementation plan:**
  - Core Engine adds an `obscuredCells?: Set<string>` field on `Battlefield` (cell-key = `${x},${y},${z}`).
  - Darkness / Fog Cloud push obscured cells with `blockVision: true` ( Darkness: blocks even darkvision).
  - Greater Invisibility adds the `invisible` condition to the target (existing condition).
  - `computeLOS` checks obscured cells and returns appropriate LOS / cover results.
  - Divination spells (Arcane Eye, Clairvoyance, Scrying) extend `computeLOS` to allow remote sight.
- **Risk:** HIGH — `computeLOS` is on every attack path; changes here ripple across the engine.
- **Coordination protocol:** Core Engine designs the obscured-cells API; Cantrip-z wires spell modules.
- **Blocked spells (18):**
  - **Level 2 (4):** Augury, Darkness, Locate Animals or Plants, Locate Object (all PHB).
  - **Level 3 (2):** Clairvoyance (PHB), Tongues (PHB).
  - **Level 4 (4):** Arcane Eye (PHB), Divination (PHB), Greater Invisibility (PHB), Locate Creature (PHB).
  - **Level 5 (4):** Commune, Contact Other Plane, Dream, Legend Lore, Scrying (all PHB).
  - **Level 6 (2):** Find the Path (PHB), True Seeing (PHB).
  - **Level 7 (1):** Dream of the Blue Veil (TCE).
  - **Level 8 (1):** Telepathy (PHB).

### TG-011: Complex mechanics subsystem (Session 19 — bulk-deferred blockers)

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/engine/combat.ts` movement + state) + Cantrip-z (consumes in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 28 complex-mechanic spells identified)
- **Summary:** A grab-bag of spells with mechanics v1 cannot model: teleportation (Dimension Door, Thunder Step, Far Step, Teleport, Teleportation Circle, Word of Recall, Wind Walk, Etherealness, Plane Shift, Banishment, Rope Trick), resurrection (Revivify, Raise Dead, Reincarnate, Resurrection, True Resurrection, Gentle Repose), wards (Magic Circle, Forbiddance, Hallow, Unhallow, Temple of the Gods, Guards and Wards, Mighty Fortress, Contingency, Mind Blank), feast / utility (Heroes' Feast, Sending, Water Breathing, Water Walk, Awaken, Wish, Maze, Imprisonment, Astral Projection).
- **Implementation plan:**
  - Teleportation: extend `executeMove` to allow non-adjacent jumps (gated by spell module).
  - Resurrection: extend `runCombat` to allow revival from `isDead` / `isUnconscious`.
  - Wards: extend `Battlefield` with a `wards?: WardState[]` field.
  - Wish / Maze / Imprisonment / Astral Projection: each needs bespoke subsystem.
- **Risk:** HIGH — many bespoke subsystems.
- **Coordination protocol:** Core Engine designs each subsystem on a per-spell basis; Cantrip-z wires modules.
- **Blocked spells (28):**
  - **Level 2 (2):** Gentle Repose, Rope Trick.
  - **Level 3 (5):** Magic Circle, Revivify, Sending, Thunder Step, Water Breathing, Water Walk.
  - **Level 4 (2):** Banishment, Dimension Door.
  - **Level 5 (5):** Awaken, Hallow, Raise Dead, Reincarnate, Teleportation Circle.
  - **Level 6 (5):** Contingency, Forbiddance, Guards and Wards, Heroes' Feast, Wind Walk, Word of Recall.
  - **Level 7 (4):** Etherealness, Plane Shift, Resurrection, Teleport, Temple of the Gods.
  - **Level 8 (3):** Maze, Mighty Fortress, Mind Blank.
  - **Level 9 (4):** Astral Projection, Imprisonment, True Resurrection, Wish.

### TG-012: Sheet clearance on TG-001..TG-011 + RFC-stall fallback (Sheet-proposed)

- **Status:** OPEN (protocol portion — clearance portion below is DONE)
- **Owners:** Sheet (driving this entry) — protocol applies to all three workstreams
- **Source:** SHEET-HANDOVER-31 follow-up session; reviewed all of TG-001 through
  TG-011 and `docs/TG-006-SUMMON-PLAN.md` against Sheet-owned files
  (`src/characters/*`, `src/character_router.ts`, `docs/characters.html`).
- **Clearance (DONE):** Zero overlap found. Specifically checked TG-006 Phase 3
  (Find Familiar / Find Steed / Find Greater Steed) for a persistent
  companion/familiar field on the character sheet — confirmed these spawn as
  combat-only `Combatant` entries via the existing `spawnSummon` pattern, so
  no character-sheet schema change is needed. No other TG entry references
  character data, spell-list data, or any Sheet-owned file. **Sheet has no
  open prerequisite blocking any TG item today.** If a future TG item needs
  persistent character-sheet data (e.g. a permanent familiar slot), tag Sheet
  as a reviewer in that entry and this agent will pick it up next session.
- **Stall risk observed:** `zHANDOVER-SESSION-21.md` (commit `b53b622`) has
  Cantrip-z completing research + a 4-phase plan for TG-006 and explicitly
  waiting on a Core Engine RFC review before touching `combat.ts`/`runCombat`.
  Core Engine's current `TASK.md` (Tier-1 PHB 1st-level spells: Shield,
  Guiding Bolt, Healing Word) does not yet reference TG-006, so the RFC has
  no guaranteed read-by date.
- **Proposed fallback protocol (non-binding until an owning agent adopts it,
  per the RFC rule above):**
  1. A driving agent posting an RFC that needs another workstream's sign-off
     adds one line under a new `## PENDING REVIEW` log at the top of this
     file: `TG-### awaiting <workstream> review since session <N> — see <doc>`.
  2. Every agent checks that log at session start (before its own TASK.md)
     and either actions it or replies `ACKNOWLEDGED — reviewing, ETA <N>`.
  3. If 2 full sessions pass with no acknowledgment, the driving agent may
     proceed on LOW-risk, purely-additive sub-phases only (new optional
     fields, new files in directories it already owns) — it still may NOT
     touch another workstream's shared hot-path files (e.g. `runCombat`,
     `computeLOS`) without explicit sign-off, timeout or not.
  4. On completion, the driving agent deletes its `PENDING REVIEW` line and
     flips the TG entry to DONE.
- **Risk:** LOW — process-only change, no code/type impact.
- **Coordination protocol:** This entry is itself the RFC. Core Engine or
  Cantrip-z may amend/reject in their own next commit; otherwise treat as a
  recommendation, not a rule, per the RFCs section below.

---

## RFCs (Proposed shapes for cross-workstream fields)

> Any agent may propose a new RFC. Use the template at the bottom of this file.
> RFCs are PROPOSED — they become binding only when an owning agent implements
> them and removes the RFC section.

(none yet)

### TG-013: Move `rollDiceString` from `booming_blade.ts` to `utils.ts`

- **Status:** IN PROGRESS — Core Engine side DONE (session 46): added to `utils.ts`, updated `combat.ts` import. Cantrip-z to clean up re-export in `booming_blade.ts`.
- **Owners:** Cantrip-z (driving — owns `src/spells/booming_blade.ts`) + Core Engine (must update `src/engine/combat.ts` import)
- **Source:** Core Engine peer review, Session 45
- **Summary:** `rollDiceString` (parses `"NdM"` strings and rolls them) is exported from `src/spells/booming_blade.ts` and imported directly by `src/engine/combat.ts` (line 57) for the Booming Blade detonation in `executeMove`. A spell module must not be a utility dependency of the engine. `utils.ts` already owns `rollDie` and `rollDice`; this function belongs there too.
- **Implementation plan:**
  - Cantrip-z: add `export function rollDiceString(expr: string): number` to `src/engine/utils.ts` (identical body to the current one in `booming_blade.ts`).
  - Cantrip-z: remove the export from `booming_blade.ts`, or replace it with `export { rollDiceString } from '../engine/utils'` if `booming_blade.test.ts` imports it directly from the spell module.
  - Core Engine (or Cantrip-z if Core Engine approves): update `combat.ts` line 57 to `import { ..., rollDiceString } from './utils'` and remove the alias `rollBoomingBladeDice`.
  - Run `booming_blade.test.ts` and `combat.test.ts` to confirm no regressions.
- **Risk:** LOW — pure refactor, no behaviour change. The function body is identical; only the import path changes.
- **Coordination protocol:** Cantrip-z may make the `utils.ts` addition and `booming_blade.ts` change unilaterally. The `combat.ts` import line is Core Engine territory — Cantrip-z should either make it in the same PR and note the change in their handover, or flag it here for Core Engine to pick up.

### TG-014: Fix "melee spell attack" label in Booming Blade and Green-Flame Blade comments

- **Status:** OPEN
- **Owners:** Cantrip-z (driving — owns both spell modules)
- **Source:** Core Engine peer review, Session 45
- **Summary:** TCE is unambiguous — both spells say "make a melee attack with it… the target suffers the **weapon attack's** normal effects." The current module headers and inline comments incorrectly label the primary hit as a "melee spell attack (attackType='spell')". No behaviour change is needed (the engine routes these through the weapons array, so `hitBonus` is already sourced from the weapon, not `spellAttackBonus`), but the incorrect label risks misleading a future implementer into routing them through the SPELL_DB spell-attack path.
- **Implementation plan:**
  - `src/spells/booming_blade.ts` line 31: change "melee spell attack (attackType='spell')" → "melee weapon attack".
  - `src/spells/green_flame_blade.ts` line 36: same change.
  - `src/spells/green_flame_blade.ts` line 263: update "after the melee spell" → "after the melee weapon attack".
- **Risk:** LOW — comment-only change, zero behaviour impact.
- **Coordination protocol:** Cantrip-z owns both files; no Core Engine sign-off needed.

---

## SECTION TEMPLATE

When adding a new cross-workstream task, use:

```markdown
### TG-NNN: <short title>

- **Status:** OPEN | IN PROGRESS | DONE | BLOCKED
- **Owners:** <workstream> (driving) + <workstream> (reviewer)
- **Source:** <handover file or session note>
- **Summary:** <2-4 sentences>
- **Implementation plan:** <bullet list of files to touch>
- **Risk:** LOW | MEDIUM | HIGH
- **Coordination protocol:** <how the agents agree on the design>
```

For an RFC:

```markdown
### RFC-NNN: <field/shape name>

- **Proposed by:** <workstream>
- **Target file:** `src/types/core.ts` (or wherever)
- **Shape:**
  ```typescript
  // TypeScript interface or type alias
  ```
- **Rationale:** <2-3 sentences>
- **Status:** PROPOSED | APPROVED | REJECTED | SUPERSEDED
```
