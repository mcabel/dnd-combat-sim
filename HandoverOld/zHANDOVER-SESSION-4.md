# zHANDOVER-SESSION-4

## REPOSITORY

- Branch: main
- Commits this session:
  - `a743591` — Cantrip-2: Implement Shocking Grasp cantrip (PHB p.275)  [prior session]
  - `<new>`    — Cantrip-3: Implement Chill Touch cantrip (PHB p.221)
  - `<new>`    — Cantrip-4: Implement Blade Ward cantrip (PHB p.218)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: user provides in chat each session. do not warn.

> **RECOVERY NOTE:** See zHANDOVER-SESSION-3 for the recovery context. Sessions
> 3/4/5 were lost in a failed push and are being re-applied in this fix session.

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrips** | **THIS agent (you)** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — DO NOT TOUCH |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip workstream)

- **Your tasks come from `zHANDOVER-SESSION-*.md`.**
- **Cantrip Workstream Status:** All PHB (2014) Cantrips are now **COMPLETE**.
  - Implemented: Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Blade Ward.
- No further implementation tasks are pending for this workstream unless the user
  specifies a new scope (e.g., Elemental Evil UA cantrips).

---

## COMPLETED THIS SESSION

### Feature: Blade Ward (`src/spells/blade_ward.ts`)

- PHB p.218: level 0 abjuration, action, self-cast (Range: Self).
- **Architectural Expansion (first non-attack cantrip):**
  - Previous cantrips were all attacks and rode the `resolveAttack` path.
  - Blade Ward is a **self-buff** — no attack roll, no target.
  - To avoid violating the "no `case 'spellName'` in `executePlannedAction`" rule,
    introduced a new registry `CANTRIP_SELF_EFFECTS` in `src/engine/cantrip_effects.ts`.
  - Added a generic router `resolveCantripAction(caster, actionName, state)` that
    `executePlannedAction` consults for non-attack cantrips **before** `resolveAttack`.
    If it returns `true`, the action is fully resolved as a self-buff and
    `resolveAttack` is skipped. Unknown cantrip names return `false` (fall through).
- Mechanics:
  - Sets `_bladeWardActive = true` on the caster.
  - `applyDamageWithTempHP()` in `utils.ts` now treats `_bladeWardActive` as a
    resistance source for bludgeoning/piercing/slashing (PHB p.218). Damage is
    halved (rounded down, PHB p.197).
  - **Design choice — why the damage choke point, not `resolveAttack`:** Folding
    Blade Ward into `applyDamageWithTempHP`'s single `hasResistance` boolean
    guarantees it **never double-halves** with Rage (B/P/S in `resistances`) or
    Warding Bond (resistance to all). Two sources of the same resistance = half,
    not quarter (PHB p.197). This is verified by tests 7 & 8. The slight scope
    broadening (also applies to save-based B/P/S damage, which is rare) is
    acceptable and arguably correct.
  - Cleanup: `cleanup(combatant)` clears `_bladeWardActive`; called from `resetBudget()`.

### Integration points touched

- `src/types/core.ts`: Added `_bladeWardActive?: boolean` to `Combatant`.
- `src/engine/cantrip_effects.ts`: Added `CANTRIP_SELF_EFFECTS` map + exported
  `resolveCantripAction()`; imported Blade Ward's `applySelfEffect`.
- `src/engine/combat.ts`: `executePlannedAction` `case 'attack'/'cast'` now calls
  `resolveCantripAction(actor, plan.action.name, state)` **before** the target-null
  guard (self-buffs have no target) and before `resolveAttack`.
- `src/engine/utils.ts`: `applyDamageWithTempHP` adds the Blade Ward B/P/S clause
  to `hasResistance`; `resetBudget()` calls `cleanupBladeWard`.

### Tests

- `src/test/blade_ward.test.ts`: 38 tests, all passing. Covers metadata,
  `resolveCantripAction` flag-setting + unknown-cantrip no-op, deterministic
  damage halving for all 3 physical types, NO reduction for all 10 non-physical
  types, no reduction when flag unset/false, **non-stacking with Rage** (16→8 not
  4), **non-stacking with Warding Bond** (16→8 not 4, and Warding Bond still
  resists fire), and `resetBudget` cleanup.

---

## DISCOVERIES RELEVANT TO NEXT SESSION

1. **Cantrip architecture is now flexible.** The three-registry separation —
   `CANTRIP_EFFECTS` (post-hit), `CANTRIP_ATTACK_ADVANTAGE` (pre-roll), and
   `CANTRIP_SELF_EFFECTS` (instant/self) — allows implementing any future cantrip
   without touching the core dispatcher switch statements.
2. **Resistance composition lives in `applyDamageWithTempHP`.** Any new
   damage-resistance source (spell, class feature, racial trait) should be folded
   into that single `hasResistance` boolean rather than applied at multiple call
   sites, to guarantee PHB-correct non-stacking.
3. **Self-buff cantrip routing.** `executePlannedAction` now has a one-line
   `resolveCantripAction` check at the top of the `attack`/`cast` case. Future
   self-buff cantrips (e.g. True Strike, if reworked) just register in
   `CANTRIP_SELF_EFFECTS` — no dispatcher changes needed.
4. **AI planner does not yet plan Blade Ward.** The engine routing is in place, so
   IF a plan to cast Blade Ward arrives, it works. But the AI planner
   (`src/ai/planner.ts`) does not currently select self-buff cantrips. Making a
   smart caster cast Blade Ward when threatened is an AI task, not a cantrip
   task — out of scope for this workstream.

---

## IMMEDIATE NEXT ACTION

**Workstream Complete.**

All PHB (2014) Cantrips have been implemented:
1. **Thorn Whip** (Attack/Control)
2. **Ray of Frost** (Attack/Control/Debuff)
3. **Shocking Grasp** (Attack/Buff/Debuff)
4. **Chill Touch** (Attack/Debuff/Undead Control)
5. **Blade Ward** (Buff/Defense)

The **Cantrip Workstream** has no remaining tasks. If the user requests further
work, it should be explicitly defined (e.g., "Add Toll the Dead" or "Add Acid Splash").

---

## TEST STATUS

- `blade_ward.test.ts`: 38/38 passing
- `chill_touch.test.ts`: 38/38 passing
- `shocking_grasp.test.ts`: 26/26 passing
- `thorn_whip.test.ts`: 11/11 passing
- Full regression suite (51 files, ~2600+ tests): all green
- `tsc --noEmit`: 0 errors (Build is GREEN)

---

## NOTES FOR NEXT AGENT

- Cantrip implementation is **feature complete** for PHB 2014.
- **Parser tech debt:** `hasMetalArmor` and `isUndead` both exist as optional
  flags on `Combatant` but are NOT yet populated by `src/parser/pc.ts` /
  `src/parser/fivetools.ts`. Tests set them directly. A future parser task should
  populate them so Shocking Grasp advantage and Chill Touch's undead rider work
  end-to-end on imported characters.
- **Build hygiene:** `tsc --noEmit` is green. All scratch fields are properly
  typed and cleaned up by `resetBudget`.

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md`
  file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE
  GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a
  push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
