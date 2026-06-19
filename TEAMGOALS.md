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
