# zHANDOVER — Session 58

**Date:** 2026-06-23
**Agent:** Z.ai (Core Engine workstream — TG-031)
**Focus:** Execute TG-031 — Flurry of Blows (Monk 2, PHB p.78) + Open Hand Technique (Open Hand Monk 3, PHB p.79). This was the #1 Tier-B priority, UNBLOCKED by TG-024 (ki transfer landed in Session 55). Implements the monk's signature bonus-action attack + the Open Hand Tradition's per-Flurry rider (prone/push/disabler on hit).

---

## Session Summary

Session 58 continued the Core Engine workstream after Session 57 (TG-030). Per `TASK.md`'s Immediate Priority list, TG-031 was the #1 priority. This session:

1. **Discovered Flurry of Blows was NOT implemented.** The TG-031 spec said "In combat.ts Flurry-of-Blows case, after the second attack, apply the chosen effect" — but there WAS no Flurry-of-Blows case. The spec assumed it existed. So TG-031 required implementing BOTH Flurry of Blows itself AND the Open Hand Technique rider.

2. **Implemented the fix** across 4 files (single commit):
   - `src/types/core.ts`: Added `| 'flurryOfBlows'` to `PlannedAction.type` union; added `openHandTechniqueChoice?: 'prone' | 'push' | 'disabler'` to `PlannedAction` (NOT `TurnPlan` — the choice is specific to the Flurry of Blows action, and `executePlannedAction` only receives `PlannedAction`).
   - `src/engine/combat.ts`: Imported `Condition` type; added `case 'flurryOfBlows':` to `executePlannedAction` (after `case 'quiveringPalm':`).
   - `src/ai/planner.ts`: Added a Flurry of Blows branch to `planBonusAction` (section 2.3, after Second Wind).
   - `src/test/open_hand_technique.test.ts`: New test file, 27 assertions.

3. **v1 design decisions:**
   - **Single rider per Flurry:** The spec said "rider fires once per Flurry (after the second hit), not per hit." PHB p.79 says "immediately after you hit" (per hit), but per-hit sequencing is fiddly for v1. The rider fires once after both unarmed strikes resolve, if at least one hit landed.
   - **`openHandTechniqueChoice` on `PlannedAction`, not `TurnPlan`:** The original spec suggested `TurnPlan`, but `executePlannedAction` only receives `PlannedAction` — so the choice must live on `PlannedAction` to be accessible in the `case 'flurryOfBlows':` handler.
   - **Disabler v1 simplification:** PHB p.79 says "can't take reactions until the end of YOUR next turn" (the monk's). v1 sets `budget.reactionUsed = true` on the target, which prevents reactions until `resetBudget` clears it at the start of the TARGET's next turn. The target may recover slightly early if they act before the monk's next turn, but for v1 single-combat scope this is acceptable.
   - **Martial Arts die scaling:** The unarmed strike Action uses the monk's Martial Arts die: 1d4 (levels 1-4), 1d6 (5-10), 1d8 (11-16), 1d10 (17-20). Hit bonus = prof + max(DEX, WIS) per PHB p.76.

4. **Wrote 27 test assertions** covering: feature/ki setup, 1 ki spent, 2 unarmed strikes (damage dealt), 'prone' rider (DEX save fail → prone), 'push' rider (STR save fail → pushed 15 ft), 'disabler' rider (reactionUsed = true), insufficient ki → no-op, out of range → no-op, vanilla monk → no rider, hit bonus verification, target dies mid-flurry (second strike skipped), default choice 'prone', ki save DC verification (8 + prof + WIS = 19), costType verification.

5. **Ran regression sweep.** `tsc --noEmit` clean. All 11 affected test files pass: combat, engine, mechanics, phase4, integration, scenario, ai, wholeness_of_body, diamond_soul, quivering_palm, resources. Zero regressions.

**Total this session:** ~150 lines of new code (combat.ts case + planner branch + type additions), 1 new test file (27 assertions), 2 doc files updated (TEAMGOALS, TASK), 1 handover, 1 handover archived.

---

## Architecture

### The `'flurryOfBlows'` action type

```
Planner (planBonusAction, section 2.3)    Engine (executePlannedAction, case 'flurryOfBlows')
───────────────────────────────────────   ─────────────────────────────────────────────────
if monk has:                              1. Guard: ki.remaining >= 1
  - Ki feature                            2. Guard: target valid + alive
  - ≥ 1 ki                                3. Guard: distance ≤ 5 ft (melee)
  - living enemy in 5 ft                  4. Spend 1 ki
                                           5. Construct unarmed strike Action:
→ return {                                    hitBonus = prof + max(DEX, WIS)
  type: 'flurryOfBlows',                     damage = martialDie + max(DEX, WIS)
  targetId: <melee enemy>,                   martialDie scales: 1d4/1d6/1d8/1d10
  openHandTechniqueChoice: <choice>       6. Loop 2×: resolveAttack (skip if target dies)
}                                          7. Count hits via log event inspection
                                           8. If hasFeature('Open Hand Technique') + hits > 0:
                                             Apply rider (choice defaults to 'prone'):
                                             - 'prone': DEX save (DC 8+prof+WIS) or addCondition
                                             - 'push': STR save or pushAway 15 ft
                                             - 'disabler': budget.reactionUsed = true
```

### Why `openHandTechniqueChoice` is on `PlannedAction`, not `TurnPlan`

The original TG-031 spec suggested `TurnPlan.openHandTechniqueChoice`. But `executePlannedAction(actor, plan: PlannedAction, state)` only receives the `PlannedAction` — it doesn't have access to the parent `TurnPlan`. The choice is specific to the Flurry of Blows action, so it belongs on the `PlannedAction` that represents that bonus action. This is consistent with `spellName` (also on `PlannedAction` for `genericSpell` dispatch) and `healAmount` (on `PlannedAction` for heal actions).

### Hit detection via log inspection

`resolveAttack` doesn't return hit/miss. To determine whether the Open Hand Technique rider should fire, the code inspects the last 6 log events for an `attack_hit` or `attack_crit` event matching the actor + target. This is slightly fragile but works for v1 — the events are pushed synchronously during `resolveAttack`, so the last 6 events always include the most recent attack's hit/miss outcome.

### Disabler v1 simplification

PHB p.79: "It can't take reactions until the end of your next turn" (the monk's next turn). v1 sets `budget.reactionUsed = true` on the target. This prevents reactions until `resetBudget` clears it at the start of the TARGET's next turn. If the target acts before the monk's next turn, they'd recover their reaction slightly early (canon: they shouldn't react until the monk's next turn ends). For v1 single-combat scope, this is an acceptable simplification — documented in the code comment.

### Planner AI heuristic

The planner picks the Open Hand Technique choice based on target state:
- **'disabler'** if the target has spell slots (caster — prevents Counterspell/Shield reactions, which are the most dangerous reactions in v1)
- **'prone'** otherwise (gives melee advantage to the monk + allies)
- **'push'** is situational (edge of pit) — v1 doesn't model terrain hazards, so the AI never picks 'push' (tests can set it manually via `openHandTechniqueChoice`)

---

## Files Changed (Session 58)

### New files (2)
- `src/test/open_hand_technique.test.ts` — TG-031 tests (27 assertions)
- `zHANDOVER-SESSION-58.md` — this file

### Modified files (4)
- `src/types/core.ts` — Added `| 'flurryOfBlows'` to `PlannedAction.type` union; added `openHandTechniqueChoice?: 'prone' | 'push' | 'disabler'` to `PlannedAction`.
- `src/engine/combat.ts` — Imported `Condition` type; added `case 'flurryOfBlows':` to `executePlannedAction` (~95 lines including comments, guards, unarmed strike construction, 2× resolveAttack loop, Open Hand Technique rider with 3 choice branches).
- `src/ai/planner.ts` — Added Flurry of Blows branch to `planBonusAction` (section 2.3, ~30 lines: feature check, ki check, melee-range target search, AI heuristic for choice selection).
- `TEAMGOALS.md` — TG-031 status `OPEN` → `DONE — Session 58`.
- `TASK.md` — Core Engine Active Objective refreshed (S57 → S58, now TG-028 label fix); TG-031 marked DONE; Immediate Priority updated (TG-028 is the LAST remaining Core Engine task).

### Moved files (1)
- `zHANDOVER-SESSION-56.md` → `HandoverOld/zHANDOVER-SESSION-56.md` (per AGENTS.md "max 2 of each handover type in root" rule — root now has 57 + 58).

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| `open_hand_technique.test.ts` (27) | ✅ All pass — NEW |
| `combat.test.ts` | ✅ All pass |
| `engine.test.ts` | ✅ All pass |
| `mechanics.test.ts` | ✅ All pass |
| `phase4.test.ts` | ✅ All pass |
| `integration.test.ts` | ✅ All pass |
| `scenario.test.ts` | ✅ All pass |
| `ai.test.ts` | ✅ All pass |
| `wholeness_of_body.test.ts` | ✅ All pass |
| `diamond_soul.test.ts` | ✅ All pass |
| `quivering_palm.test.ts` (31) | ✅ All pass |
| `resources.test.ts` | ✅ All pass |

**New assertions this session: 27.** All existing tests remain green. No regressions.

---

## CI Status

Single commit pushed to `main` (this session):
- `dcd44de` — Session 58 Core Engine TG-031: Flurry of Blows + Open Hand Technique

CI should pass (all local tests green; the new `case 'flurryOfBlows':` is exercised by the new test + the AI planner test).

---

## Next Session Priorities

### Core Engine (per TASK.md updated Immediate Priority list)

1. **TG-028** (PHB 2014/TCE): Booming/Green-Flame Blade "melee spell attack" label fix — **comment-only**, the LAST remaining Core Engine task. Cantrip-z owns both files. Risk: ZERO.

After TG-028, **all Tier-A + Tier-B Core Engine tasks will be DONE.** The remaining work is:
- Tier-C (HIGH risk, deferred): TG-001 (RFC done, ongoing), TG-007 (Wall), TG-010/TG-021 (vision), TG-011 (28 complex spells), TG-006 Phase 4 (19 summon spells).
- Creature Megabatch Batch 5 (DEFERRED): Lair actions, monster spellcasting, shapechanger.

### Sheet Agent (per TASK.md Sheet section)

- **TG-025** (PHB 2014): Per-class unarmored-AC hook — Sheet drives unilaterally.
- **TG-026** (PHB 2014): Resources panel UI for Ki + Sorcery Points — UNBLOCKED (TG-024 done).
- **TG-029** (PHB 2014): Champion 10 second Fighting Style — Sheet drives steps 1-4.

---

## Commit Log (Session 58)

```
Session 58 Core Engine TG-031: Flurry of Blows + Open Hand Technique
  - PHB p.78 (Flurry of Blows): "Immediately after you take the Attack
    action on your turn, you can spend 1 ki point to make two unarmed
    strikes as a bonus action."
  - PHB p.79 (Open Hand Technique): "Whenever you hit a creature with one
    of the attacks granted by your Flurry of Blows, you can impose one of
    the following effects: DEX save or knocked prone; STR save or pushed
    15 ft; can't take reactions until end of your next turn."
  - Discovery: Flurry of Blows was NOT implemented before TG-031 — the
    spec assumed it existed. This commit implements BOTH Flurry of Blows
    itself AND the Open Hand Technique rider.
  - v1 simplification: rider fires ONCE per Flurry (after the second hit),
    not per hit (PHB p.79: "immediately after you hit" — per hit is more
    canon-accurate but fiddly for v1).
  - core.ts: added 'flurryOfBlows' to PlannedAction.type union; added
    openHandTechniqueChoice?: 'prone' | 'push' | 'disabler' to
    PlannedAction (NOT TurnPlan — executePlannedAction only receives
    PlannedAction).
  - combat.ts: imported Condition type; added case 'flurryOfBlows' to
    executePlannedAction. Guards: ki >= 1, target valid + alive, melee
    range (5 ft). Spends 1 ki, constructs unarmed strike Action (Martial
    Arts die scales: 1d4/1d6/1d8/1d10 by level; hitBonus = prof + max(DEX,
    WIS)), calls resolveAttack twice. If hasFeature('Open Hand Technique')
    + >= 1 hit landed, applies rider: 'prone' (DEX save or addCondition),
    'push' (STR save or pushAway 15 ft), 'disabler' (budget.reactionUsed
    = true — v1 simplification for "can't take reactions until end of
    your next turn").
  - planner.ts: added Flurry of Blows branch to planBonusAction (section
    2.3, after Second Wind). Fires when monk has Ki feature + >= 1 ki +
    living enemy in melee range. AI heuristic: 'disabler' if target has
    spell slots (caster); 'prone' otherwise. 'push' never auto-selected
    (v1 doesn't model terrain hazards — tests can set it manually).
  - New test src/test/open_hand_technique.test.ts: 27 assertions covering
    feature/ki setup, 1 ki spent, 2 unarmed strikes (damage), 'prone'
    rider (DEX save fail), 'push' rider (STR save fail, pushed 15 ft),
    'disabler' rider (reactionUsed = true), insufficient ki, out of
    range, vanilla monk (no rider), hit bonus, target dies mid-flurry,
    default choice 'prone', ki save DC (8 + prof + WIS = 19), costType.
  - All 11 regression test files pass. tsc --noEmit clean. Zero regressions.
  - TEAMGOALS.md: TG-031 status OPEN -> DONE — Session 58.
  - TASK.md: Core Engine Active Objective refreshed (S57 -> S58, now
    TG-028 label fix — the LAST Core Engine task); TG-031 marked DONE.
  - Archived zHANDOVER-SESSION-56 to HandoverOld/ (AGENTS.md "max 2 in
    root" rule — root now has 57 + 58).
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged — Core Engine workstream).
- `BestiaryMap`: 2401 unique creatures from 98 files (unchanged — no parser changes).
- **New mechanical coverage this session:**
  - Monk 2+ Flurry of Blows now works (was NOT implemented). 1 ki → 2 unarmed strikes as a bonus action. Martial Arts die scales with level.
  - Open Hand Monk 3+ Open Hand Technique rider now works (was flag-only). On Flurry of Blows hit: 'prone' (DEX save), 'push' (STR save, 15 ft), or 'disabler' (no reactions). v1: rider fires once per Flurry.
  - The Open Hand Monk's full progression is now mechanically functional: Open Hand Technique (TG-031), Wholeness of Body (Session 47), Diamond Soul (Session 48), Quivering Palm (TG-030).
- **Remaining Core Engine work:** TG-028 (comment-only label fix) — the LAST Core Engine task. All Tier-A + Tier-B tasks DONE after TG-031.
