# TASK.md

> **MULTI-AGENT PROJECT** — See `AGENTS.md` for workstream boundaries and startup rules.
> If the user uploads a handover at session start, that handover takes priority over this file.

## ACTIVE WORKSTREAM

Core Engine

---

## ACTIVE OBJECTIVE

Implement Cure Wounds as a dedicated spell module, migrating it away from the legacy `'spellHeal'` / `spellHealPlan` path.

---

## CURRENT PHASE

Tier 1 PHB combat spell coverage — 1st-level spells.

---

## ACCEPTANCE CRITERIA

Objective is complete when:

* [ ] `src/spells/cure_wounds.ts` exists with `shouldCast` / `execute` / `metadata` pattern
* [ ] `'cureWounds'` added to `PlannedAction` type union in `src/types/core.ts`
* [ ] `case 'cureWounds':` wired in `src/engine/combat.ts`
* [ ] `src/ai/planner.ts` uses `shouldCast` from `cure_wounds.ts` (replaces `spellHealPlan` call for Cure Wounds)
* [ ] `src/test/cure_wounds.test.ts` passes 0 failures
* [ ] `healing_spells.test.ts` updated for any changed assertion types, passes 0 failures
* [ ] Full baseline maintained (combat, engine, ai, resources, scenario — 0 persistent failures)

---

## ACTIVE CONSTRAINTS

* Use `testDataSpells/spells-phb.json` as authoritative data (Cure Wounds, PHB p.230).
* Follow `healing_word.ts` as the implementation template.
* `spellHealPlan` in `resources.ts` is retained but will no longer be called for Cure Wounds after this task.
* Do NOT touch sheet routes, leveler.ts, or builder.ts.
* PAT provided verbally at session start — do not paste in files.

---

## KNOWN BLOCKERS

None.
