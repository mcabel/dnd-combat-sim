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

- **Status:** OPEN
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

- **Status:** OPEN
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

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/engine/summons.ts` + `src/types/core.ts` summon-state shape) + Cantrip-z (consumes the subsystem in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 109 blocker spells identified)
- **Summary:** v1 has NO summon subsystem. 38 in-scope spells from levels 2–9 are blocked on this subsystem: all `Summon *` (TCE), all `Conjure *` (PHB), plus Animate Dead, Create Undead, Create Magen, Find Familiar, Find Steed, Find Greater Steed, Magic Jar, Planar Ally, Planar Binding, Gate, Infernal Calling, Glyph of Warding, Symbol, Simulacrum, True Polymorph, Shapechange, Clone, Demiplane, Drawmij's Instant Summons, Leomund's Secret Chest, Programmed Illusion.
- **Implementation plan:**
  - Add `summons?: SummonState[]` field to `Battlefield` (Core Engine owns `src/types/core.ts`).
  - Each `SummonState` tracks: summon ID, caster ID, stat block reference, expiry turn, control mode (loyal/hostile/wild), HP.
  - Core Engine adds a `runSummonTurn` hook in `runCombat` (after the caster's turn).
  - Cantrip-z wires each `Summon *` / `Conjure *` spell module to push a `SummonState` and consume the slot.
- **Risk:** HIGH — adds a new turn-order dimension. All 38 spells must agree on `SummonState` shape.
- **Coordination protocol:** Core Engine announces the RFC; Cantrip-z implements spell modules once the shape is locked.
- **Blocked spells (38):**
  - **Level 2 (2):** Find Steed (PHB), Summon Beast (TCE).
  - **Level 3 (8):** Animate Dead (PHB), Conjure Animals (PHB), Conjure Barrage (PHB), Conjure Constructs (FRHoF), Glyph of Warding (PHB), Summon Fey (TCE), Summon Lesser Demons (XGE), Summon Shadowspawn (TCE), Summon Undead (TCE).
  - **Level 4 (7):** Conjure Minor Elementals (PHB), Conjure Woodland Beings (PHB), Find Greater Steed (XGE), Leomund's Secret Chest (PHB), Summon Aberration (TCE), Summon Construct (TCE), Summon Elemental (TCE), Summon Greater Demon (XGE).
  - **Level 5 (5):** Conjure Elemental (PHB), Conjure Volley (PHB), Infernal Calling (XGE), Planar Binding (PHB), Summon Celestial (TCE), Summon Draconic Spirit (FTD).
  - **Level 6 (5):** Conjure Fey (PHB), Create Undead (PHB), Drawmij's Instant Summons (PHB), Magic Jar (PHB), Planar Ally (PHB), Programmed Illusion (PHB), Summon Fiend (TCE).
  - **Level 7 (4):** Conjure Celestial (PHB), Create Magen (IDRotF), Simulacrum (PHB), Symbol (PHB).
  - **Level 8 (2):** Clone (PHB), Demiplane (PHB).
  - **Level 9 (4):** Gate (PHB), Shapechange (PHB), True Polymorph (PHB), (Drawmij's Instant Summons counted at L6).

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

- **Status:** OPEN
- **Owners:** Core Engine (driving — owns `src/engine/combat.ts` reaction window) + Cantrip-z (consumes in spell modules)
- **Source:** `zHANDOVER-SESSION-19.md` (Session 19 bulk-implementation pass — 5 reaction spells identified)
- **Summary:** v1 has NO reaction subsystem beyond pre-set reactions in TurnPlan. Several classic spells are reaction-cast (triggered by an incoming attack / spell / fall). 5 in-scope spells blocked.
- **Implementation plan:**
  - Core Engine adds a `triggerReaction(actor, event)` hook in `resolveAttack` / `castSpell` paths.
  - Reaction spells register a trigger condition (incoming-attack / incoming-spell / falling).
  - When the trigger fires, the engine invokes the spell's `execute` if a slot is available.
- **Risk:** MEDIUM — additive hook; no engine disruption.
- **Coordination protocol:** Core Engine announces the trigger API; Cantrip-z wires spell modules.
- **Blocked spells (5):**
  - **Level 1 (3):** Absorb Elements (XGE), Shield (PHB), Feather Fall (PHB).
  - **Level 1 (1):** Hellish Rebuke (XGE).
  - **Level 1 (1):** Silvery Barbs (SCC).
  - **Level 3 (1):** Counterspell (PHB).
  - **Level 3 (1):** Protection from Energy (PHB) — categorized as reaction because the broader "Protection from *" family overlaps with Shield's reaction model.

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

---

## RFCs (Proposed shapes for cross-workstream fields)

> Any agent may propose a new RFC. Use the template at the bottom of this file.
> RFCs are PROPOSED — they become binding only when an owning agent implements
> them and removes the RFC section.

(none yet)

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
