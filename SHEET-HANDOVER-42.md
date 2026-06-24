# SHEET-HANDOVER-42
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `c485b2d`
- Repository state: clean, pushed
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

### Sheet-42 — outOfCombat flag + 10 utility spell stubs (`c485b2d`)

`SpellTemplate` gains `outOfCombat?: boolean`.  Ten PHB 2014 utility/ritual
spells added to SPELL_DB with `outOfCombat: true`, `attackType: null`,
`damage: null`:  detect magic, comprehend languages, identify, locate object,
clairvoyance, sending, tongues, water breathing, divination, locate creature.

Source: delegated via `docs/SPELL-DELEGATION-SPEC.md` (Session 60, Z.ai).
Safety net for Batch 5b step 2 — monster spell-selection loop checks this
flag and skips the spell rather than logging a "spell not found" warning.

New test: `src/test/out_of_combat_spells.test.ts` (66 assertions).

---

## DISCOVERIES RELEVANT TO NEXT TASK

- TG-025, TG-026, TG-029 are all implemented in the repo despite TASK.md
  listing them as not-started — repo state is authoritative; TASK.md is stale
  for those items.
- `outOfCombat` is currently only a SPELL_DB flag; the Batch 5b step 2 engine
  loop (in `src/engine/combat.ts` / `src/ai/planner.ts`, Core files) must
  actually read it when wiring monster spell selection.  Sheet's part is done.

---

## OPEN BLOCKERS

None.

---

## IMMEDIATE NEXT ACTION

Check `docs/SPELL-DELEGATION-SPEC.md` for any further Sheet-tagged items, or
get a new objective from Ares.  All known Sheet tasks from TASK.md are done.

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 89 |
| character_leveler.test.ts | 256 |
| character_improvements.test.ts | 108 |
| server.test.ts | 263 |
| out_of_combat_spells.test.ts | 66 |
| **Total** | **782** |

All 0 failures. `tsc --noEmit` clean.
