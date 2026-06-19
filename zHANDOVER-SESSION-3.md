# zHANDOVER-SESSION-3

## REPOSITORY

- Branch: main
- Commits this session:
  - `a743591` — Cantrip-2: Implement Shocking Grasp cantrip (PHB p.275)  [prior session, already pushed]
  - `<new>`    — Cantrip-3: Implement Chill Touch cantrip (PHB p.221)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: user provides in chat each session. do not warn.

> **RECOVERY NOTE (this session):** Sessions 3, 4, and 5 were originally produced
> by a prior agent but **never pushed** to GitHub (the repo was stuck at Session 2,
> commit `35f650a`). The user supplied a rescue archive containing handover drafts
> and test stubs. The rescued test stubs were written against a **different /
> hallucinated architecture** (vitest + a `Spell` interface with `isAttack`/`isSave`
> + `Combatant` fields `hp`/`maxHp`/`position`/`budget:{action,bonusAction,reaction}`)
> that does **not** match this codebase (ts-node harness, `currentHP`/`pos:Vec3`/
> `budget:{movementFt,actionUsed,...}`). They were therefore **rewritten** against
> the real architecture. See zHANDOVER-SESSION-5 for the full recovery report.

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrips** | **THIS agent (you)** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — DO NOT TOUCH |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip workstream)

- **Your tasks come from `zHANDOVER-SESSION-*.md`.**
- Implement cantrips per PHB (2014 rules only). Remaining cantrip after this session: **Blade Ward**.
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts`.
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).

---

## COMPLETED THIS SESSION

### Feature: Chill Touch (`src/spells/chill_touch.ts`)

- PHB p.221: level 0 necromancy, action, 120 ft ranged spell attack, 1d8 necrotic.
- Two riders on hit:
  1. **Target can't regain hit points** until the start of your next turn.
     - Implemented via `target._chillTouchNoHealing = true`.
     - `applyHeal()` in `src/engine/utils.ts` checks this flag and short-circuits
       to `return 0` (no healing). The lock itself is logged by the cantrip's
       `applyCantripEffect`; `applyHeal` stays silent.
  2. **If the target is undead, it has disadvantage on attack rolls against you**
     until the end of your next turn.
     - Implemented via `target._chillTouchDisadvVs = caster.id` (only when
       `target.isUndead === true`).
     - `resolveAttack()` in `src/engine/combat.ts` folds this into the attack's
       `disadvantage` boolean: `attacker._chillTouchDisadvVs === target.id`.
       This is a surgical, targeted hook (only vs the specific caster), gated by
       a cantrip scratch field — consistent with the existing `cantripAdv` hook
       for Shocking Grasp.
- Registered in `CANTRIP_EFFECTS` (post-hit dispatcher) in `cantrip_effects.ts`.
- Cleanup: `cleanup(combatant)` clears both flags; called from `resetBudget()`.

### Undead detection

- Added `isUndead?: boolean` to `Combatant` in `src/types/core.ts` (optional;
  undefined → treated as non-undead). This mirrors the established `hasMetalArmor?`
  pattern. The parser does NOT yet populate it (parser tech debt, same as
  `hasMetalArmor`); tests set it directly.

### Integration points touched

- `src/types/core.ts`: Added `_chillTouchNoHealing?: boolean`,
  `_chillTouchDisadvVs?: string`, and `isUndead?: boolean` to `Combatant`.
- `src/engine/cantrip_effects.ts`: Added `'Chill Touch'` to `CANTRIP_EFFECTS`;
  imported its `applyCantripEffect`.
- `src/engine/combat.ts`: Added the undead-disadvantage fold in `resolveAttack`
  (one `const chillTouchDisadv = ...` + fold into `disadvantage` + log line).
- `src/engine/utils.ts`: `applyHeal()` now short-circuits on
  `_chillTouchNoHealing`; `resetBudget()` now calls `cleanupChillTouch`.

### Tests

- `src/test/chill_touch.test.ts`: 38 tests, all passing. Covers metadata,
  no-heal rider on any target, undead-disadv rider gating (true undead / false /
  undefined), dispatcher integration + unknown-cantrip no-op safety, end-to-end
  `applyHeal` heal-block, and `resetBudget` cleanup restoring healing.

---

## DISCOVERIES RELEVANT TO NEXT TASK

1. **Healing interception is a clean choke point.** `applyHeal()` in `utils.ts`
   is the single place all healing flows through. Future "no heal" effects
   (e.g. Wither and Bloom if it were in scope) can reuse the same flag/short-circuit
   pattern.
2. **Targeted disadvantage needs a scratch field, not the `vulnerabilities` system.**
   The `vulnerabilities: AdvantageEntry[]` array scopes by d20-test type, not by
   target. "Undead has disadv vs THIS caster specifically" cannot be expressed by
   it. A scratch field holding the caster's ID, checked in `resolveAttack`, is the
   minimal correct approach.
3. **`isUndead` parser population is tech debt** (same status as `hasMetalArmor`).
   A future task should populate it from the 5etools `type` field in
   `src/parser/fivetools.ts` (which already scans for `'undead'`).

---

## IMMEDIATE NEXT ACTION

Implement **Blade Ward** cantrip (`src/spells/blade_ward.ts`):
- PHB p.218: level 0 abjuration, action, self-cast (Range: Self).
- Effect: Resistance to bludgeoning, piercing, and slashing damage dealt by
  weapon attacks until the start of your next turn.
- **Architectural challenge:** first NON-attack cantrip (self-buff). It must NOT
  ride `resolveAttack` or `CANTRIP_EFFECTS`. Introduce a `CANTRIP_SELF_EFFECTS`
  registry + `resolveCantripAction()` helper in `cantrip_effects.ts`, consulted by
  `executePlannedAction` BEFORE `resolveAttack` (so self-buffs bypass the attack
  roll). This keeps cantrip logic out of the switch (no `case 'spellName'`).
- For the damage reduction, prefer the existing resistance choke point
  `applyDamageWithTempHP()` in `utils.ts` (add a Blade Ward clause) so it
  composes correctly with Rage/Warding Bond and never double-halves.

---

## TEST STATUS

- `chill_touch.test.ts`: 38/38 passing
- `shocking_grasp.test.ts`: 26/26 passing
- `thorn_whip.test.ts`: 11/11 passing
- Full regression suite (51 files): all green
- `tsc --noEmit`: 0 errors (Build is GREEN)

---

## NOTES FOR NEXT AGENT

- Cantrips implemented so far: Thorn Whip, Ray of Frost, Shocking Grasp, **Chill Touch**.
- Cantrips remaining: **Blade Ward**.
- All cantrip post-hit effects → `CANTRIP_EFFECTS` in `cantrip_effects.ts`.
- All cantrip pre-roll advantage → `CANTRIP_ATTACK_ADVANTAGE` in `cantrip_effects.ts`.
- All cantrip self-buffs (non-attack) → `CANTRIP_SELF_EFFECTS` in `cantrip_effects.ts` (to be added in Session 4).
- Cantrip scratch fields on `Combatant` are optional (`?`) and cleared by each
  module's `cleanup()` from `resetBudget()`.
- **Remember:** your priority is the cantrip workstream (zHANDOVER). Do NOT
  implement TASK.md spell items — those belong to the Core Engine agent. Do NOT
  edit `HANDOVER-SESSION-*` or `SHEET-HANDOVER-*` files.
- Commit message convention: `Cantrip-N: <summary>` (this session was Cantrip-3).

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
