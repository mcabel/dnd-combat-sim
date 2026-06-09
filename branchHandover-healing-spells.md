# branchHandover — Healing Spells (Session 29–30, Branch B)

## Status: INCOMPLETE — Do not assume this is production-ready
Last committed: `c1dffbb` (spell actions, 1374 tests)
Uncommitted changes: 5 files modified, **compiles clean**, **3 tests broken** (see below)

---

## GitHub Branching — Recommendation

**Short answer: keep the rebase-on-main workflow for now.**

Both agents are touching `src/engine/combat.ts`, `src/ai/planner.ts`, and `src/ai/resources.ts`.
The other agent (combat/LOS) is working on: Cunning Action Dash ✅, Cunning Action Hide (LOS
dependency), and future combat mechanics. Our overlap areas:

| File | This branch adds | Other agent adds | Risk |
|---|---|---|---|
| `src/engine/combat.ts` | `case 'spellHeal'` block | Dash ordering, `effectiveSpeed` | **LOW** — different switch cases |
| `src/ai/planner.ts` | Cure Wounds check at top of planTurn, Healing Word in planBonusAction | `planCunningAction`, `planTurn` call site | **MEDIUM** — both modify planTurn body |
| `src/ai/resources.ts` | Healing spell functions appended at end | (doesn't touch resources.ts currently) | **NONE** |

Formal GitHub branches (feature branches + PRs) would eliminate the rebase risk entirely, but
add overhead. **Recommended only if** both agents are working in the same session and will push
concurrently. For now: this branch commits to main, rebases on conflict. The `planner.ts`
modifications are in clearly separate locations (Healing Word is in `planBonusAction`; Cure
Wounds is at the top of the regular `planTurn` path; neither touches `planCunningAction`).

**If the conflict situation changes (both agents working same session, frequent conflicts),
escalate to user: ask to create `feature/spell-ai` branch.**

---

## Uncommitted Changes (not yet committed)

### 1. `src/types/core.ts`
Added `'spellHeal'` to `PlannedAction.type` union:
```typescript
| 'spellHeal'    // Cure Wounds (action) or Healing Word (bonus action)
```
Updated `healAmount` comment to include `spellHeal`.

### 2. `src/data/spells.ts`
Added two heal-only entries at the top of `SPELL_DB`. These have `attackType: null` and
`damage: null` — they are **never selected by `selectAction`**. They exist only so the parser
creates `Action` objects for them, which the planner detects by name.

```typescript
'cure wounds':  { attackType: null, rangeNormal: 5,  damage: null, slotLevel: 1 }
'healing word': { attackType: null, rangeNormal: 60, damage: null, slotLevel: 1, bonusAction: true }
```

### 3. `src/ai/resources.ts` (appended, no existing code changed)
Three new private/exported functions:
- `healSpellTarget(caster, rangeFt, bf)` — finds best heal target: downed ally → critical self → critical ally
- `shouldCastCureWounds(caster, bf)` — returns Combatant to heal (touch range 5ft) or null
- `shouldCastHealingWord(caster, bf)` — returns Combatant to heal (60ft range) or null
- `spellHealPlan(caster, targetId, isHealingWord)` — consumes slot, rolls 1d8+WIS or 1d4+WIS, returns `spellHeal` PlannedAction

Heal thresholds: downed (isUnconscious) = always revive, otherwise self/ally below 25% HP.

### 4. `src/engine/combat.ts`
Added `case 'spellHeal'` in `executePlannedAction` — between `case 'layOnHands'` and `case 'hide'`.
Identical pattern to `layOnHands`: calls `applyHeal`, logs `heal` event, handles downed→conscious
transition with `condition_remove` log.

### 5. `src/ai/planner.ts`
Two wiring changes:

**In `planBonusAction` (priority 2.5, between Second Wind and Bardic Inspiration):**
```typescript
// --- 2.5. Healing Word (Cleric / Druid / Bard — bonus action heal) ---
const hwTarget = shouldCastHealingWord(self, battlefield);
if (hwTarget && self.actions.some(a => a.name === 'Healing Word')) {
  return spellHealPlan(self, hwTarget.id, true);
}
```

**In `planTurn` (before `selectAction`, after `selectTarget`):**
```typescript
// === CURE WOUNDS (action heal) — checked before attack ===
if (self.actions.some(a => a.name === 'Cure Wounds')) {
  const cwTarget = shouldCastCureWounds(self, battlefield);
  if (cwTarget) {
    plan.action = spellHealPlan(self, cwTarget.id, false);
    plan.targetId = cwTarget.id;
    // move toward heal target if out of touch range
    if (chebyshev3D(self.pos, cwTarget.pos) * 5 > 5) {
      plan.moveBefore = bestAdjacentPos(self, cwTarget, battlefield);
    }
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }
}
```

---

## 3 Broken Tests (easy fixes)

File: `src/test/spell_actions.test.ts`

These assertions were written last session when Cure Wounds and Healing Word were intentionally
excluded from the DB. They now need to be inverted:

| Line | Old assertion | Fix |
|---|---|---|
| Section 1 | `assert('Cure Wounds → null (healing — deferred)', lookupSpell('Cure Wounds') === null)` | Change to: `assert('Cure Wounds in DB (heal-only, no damage)', lookupSpell('Cure Wounds') !== null && lookupSpell('Cure Wounds')?.damage === null)` |
| Section 2, Druid | `assert('Druid skips Healing Word (not in DB)', !names.includes('Healing Word'))` | Change to: `assert('Druid has Healing Word action', names.includes('Healing Word'))` |
| Section 2, Bard | `assert('Bard skips Cure Wounds (healing)', !names.includes('Cure Wounds'))` | Change to: `assert('Bard has Cure Wounds action', names.includes('Cure Wounds'))` |

**These are the ONLY thing blocking a clean commit.** Fix them, run `spell_actions.test.ts`,
then run the full suite before committing.

---

## What Needs to Be Done to Finish

1. **Fix 3 broken tests** (5 minutes, see above)
2. **Write `src/test/healing_spells.test.ts`** — new test file covering:
   - `shouldCastCureWounds`: fires when ally downed, fires for self <25%, no-op when no slot
   - `shouldCastHealingWord`: same but 60ft range and bonus action
   - `spellHealPlan`: slot consumed, roll correct (1d8+WIS vs 1d4+WIS), `spellHeal` type
   - `planTurn` with Cleric: heals downed Fighter instead of attacking
   - `planBonusAction` with Bard: Healing Word fires as bonus action when ally downed
   - `runCombat` integration: Cleric revives downed ally; slots consumed
3. **Full regression** — make sure all 1374+ tests still pass
4. **Commit + push** — rebase if needed
5. **Update `branchHandover-spell-actions.md`** with the completed state

---

## Files NOT Touched (other agent can edit freely)
`src/engine/movement.ts`, `src/parser/pc.ts`, `src/scenarios/`, `src/test/` (most files),
`src/engine/utils.ts`, `src/ai/targeting.ts`, `src/ai/actions.ts`

## Files This Branch Has Modified (other agent should avoid)
- `src/types/core.ts` — `spellHeal` type added (low risk, just a type union)
- `src/data/spells.ts` — heal entries at top (no overlap with combat/LOS)
- `src/ai/resources.ts` — new functions appended at bottom (no overlap)
- `src/engine/combat.ts` — new switch case added (different section from Dash changes)
- `src/ai/planner.ts` — **MEDIUM RISK**: two new blocks in planBonusAction and planTurn.
  Other agent should not edit lines 248–265 (Healing Word block) or the Cure Wounds
  pre-check block (~lines 515–535 after rebase). In practice these are in clearly
  separate parts of the functions.

---

## What Information Would Help Next Session

No additional files needed. All context is in this handover + the code. The other agent's
HANDOVER-SESSION-30.md confirms they are not currently touching `src/ai/resources.ts` or
`src/data/spells.ts` — the only genuine conflict risk is `src/ai/planner.ts`, and the
sections modified don't overlap with their `planCunningAction` changes.

**If the next session starts after the other agent has pushed new commits:** run
`git pull --rebase` before starting, verify the 5 uncommitted files still apply cleanly
with `git stash` + `git stash pop`, then fix tests and commit.
