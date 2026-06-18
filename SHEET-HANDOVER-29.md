# SHEET-HANDOVER-29
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `a7e6bd5`
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

### Multi-agent documentation
- Created `AGENTS.md` — authoritative workstream boundaries and startup priority rule (uploaded handover supersedes TASK.md)
- Added stream/priority notes to `TASK.md`, `HANDOVER-SESSION-42.md`, `zHANDOVER-SESSION-1.md`

### Bard/Cleric/Monk/Warlock subclass prompt tests (`src/test/character_leveler.test.ts`)
- Added `makeBard()`, `makeCleric()`, `makeMonk()`, `makeWarlock()` factories
- Added 10 tests (22i–22r):
  - Bard lv2: no prompt guard; lv3: prompt fires; lv3 already chosen: no prompt
  - Cleric lv0→1: prompt fires; already chosen: no prompt
  - Monk lv2: no prompt guard; lv3: prompt fires; lv3 already chosen: no prompt
  - Warlock lv0→1: prompt fires; already chosen: no prompt

---

## DISCOVERIES RELEVANT TO NEXT TASK

- `CharacterResources.bardicInspiration` uses `{ max, remaining, dieSides: number }` — NOT `die: string` (that's the Combatant `PlayerResources` type in `core.ts`).
- `WeaponCategory` is only `'simple-melee' | 'simple-ranged' | 'martial-melee' | 'martial-ranged'` — individual weapon names (rapier, shortsword, etc.) are not valid.
- Cleric and Warlock subclass factories need `classLevels: [{ className: 'Cleric', level: 0 }]` override in tests to simulate lv0→1 (same pattern as Sorcerer 22a).

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 74 |
| character_builder.test.ts | 82 |
| character_leveler.test.ts | 207 (+10) |
| character_improvements.test.ts | 51 |
| server.test.ts | 142 |
| **Total** | **556** |

All 0 failures.

---

## IMMEDIATE NEXT ACTION

Remaining SHEET-HANDOVER-28 priorities in order:

1. **Spell list validation endpoint** — `GET /api/spells?class=Wizard&level=1` (and other classes) to power the add-spell input datalist in the spell edit UI. Reads from `testDataSpells/spells-phb.json` (and other sources). Returns spell names matching class + level filters. Wire into the `<datalist>` in `docs/characters.html` spell edit mode.

2. **Ranger spellcasting wired in builder** — verify `buildCombatant()` correctly generates Ranger spell slots at lv2+. Run existing builder tests against a lv2 Ranger sheet; add tests if slot generation is wrong.

---

## RUN TESTS

```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/character_storage.test.ts src/test/character_builder.test.ts src/test/character_leveler.test.ts src/test/character_improvements.test.ts src/test/server.test.ts; do
  echo -n "$(basename $f): "
  timeout 60 npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## GIT WORKFLOW

```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git fetch https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git main:remote-main
git rebase remote-main
git add -A
git commit -m "Sheet-29: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
```
