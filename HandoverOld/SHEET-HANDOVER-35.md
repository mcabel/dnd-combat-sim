# SHEET-HANDOVER-35
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `324e7d8`
- Repository state: clean, pushed
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

### Artificer Specialist subclasses — scope correction + completion (was "Session 3 of 3")

SHEET-HANDOVER-34 framed this as a large mechanical-complexity audit
(Alchemist formulas, Armorer power armor modes, Artillerist eldritch
cannon, Battle Smith steel defender) possibly needing its own
multi-session breakdown. Before implementing, audited how subclass
mechanics are actually modeled across this codebase and found that
framing didn't match established precedent:

- `CLASS_FEATURES` (leveler.ts) contains **exactly one** `subclass`-
  source entry per class, ever — a single generic placeholder at the
  level the subclass is chosen (e.g. Fighter/Martial Archetype,
  Paladin/Sacred Oath, Cleric/Divine Domain). No class, including ones
  with very mechanically distinct subclasses (Fighter's Battle Master
  vs. Eldritch Knight; Cleric's 7 domains), gets follow-up subclass-
  specific feature entries at later levels. Artificer's level-3
  placeholder ("Artificer Specialist... gain its first feature") was
  already added in a prior session and is complete per this pattern.
- Domain/Oath/Circle/Patron "always-prepared bonus spell" mechanics
  (the closest real analogue to Specialist spells) are not implemented
  anywhere in the codebase for any class.
- `chooseSubclass()` / `POST /choosesubclass` are fully generic —
  accept any non-empty string for any class already on the sheet, no
  per-class subclass-name validation server-side.
- `src/summons/registry.ts` confirms companion/cannon-type creatures
  (Battle Smith's Steel Defender, Artillerist's Eldritch Cannon) are
  Core Engine territory, not Sheet, and aren't built yet even for the
  much longer-standing Ranger Beast Master companion (explicitly
  tagged `// e.g. Ranger Companion (future)` in the registry) —
  confirming this is pre-existing, accepted scope deferral across the
  whole project, not something new to solve here.

**Real, concrete gap found:** `SUBCLASSES` (the dropdown catalog object
in `docs/characters.html`, ~line 879) had no `Artificer` key at all —
not even an empty array. Any Artificer character reaching level 3 saw
a fully empty subclass `<select>` and could not complete subclass
selection through the UI (confirm button would submit an empty
string, which the server correctly 400s on).

**Fix applied:** added `Artificer: ['Alchemist','Armorer','Artillerist','Battle Smith']`
to `SUBCLASSES`, matching the existing one-entry-per-class catalog
pattern. Verified no other file references specific subclass names
except the pre-existing `Eldritch Knight`/`Arcane Trickster` →
`Wizard` spellcasting-alias map, which Artificer specialists don't
need (Artificer already casts independently; specialists don't grant
new spellcasting the way EK/AT do).

Validated the edited object with a one-off `node -e` script
(extract + eval `SUBCLASSES`, confirm all 13 classes present with
non-empty arrays) per the established inline-HTML testing precedent —
not committed, no permanent test file added (consistent with how this
file's static catalog data has always been handled; nothing in
`src/test/*` exercises `docs/characters.html`).

**This closes out the TCE Artificer rollout** (class definition,
spellcasting, spell list, and subclass selection are all now in
place). No further Artificer work is queued for Sheet.

---

## DISCOVERIES RELEVANT TO NEXT TASK

- If a future session needs to model Specialist-granted "always
  prepared" spells (Alchemist/Armorer/Artillerist/Battle Smith spells,
  TCE p.18–19), there is no existing pattern to extend — Domain/Oath/
  Circle/Patron bonus spells aren't implemented for any class. That
  would be a new feature, not a localized fix, and should go through
  normal scope/architecture review rather than being bundled
  silently into a "subclass list" task.
- The pre-existing `docs/characters.html` parse bug noted in
  SHEET-HANDOVER-33/34 (duplicate `CLASS_SAVES` const, orphaned
  `showAddEquipForm` body) is still un-investigated this session —
  still out of scope, not re-verified.
- `src/test/server.test.ts` still mutates
  `characters/00000000-0000-0000-0000-000000000003.json` as a PUT-test
  side effect; reverted via `git checkout` before commit as before.

---

## OPEN BLOCKERS

- None for Sheet.

---

## IMMEDIATE NEXT ACTION

No queued Sheet work. Check with Ares for next objective, or consult
TEAMGOALS.md for any new cross-workstream items tagged Sheet (none as
of this session's TG-012 entry, which Sheet itself authored last
session and is purely informational/coordination, not an action
item).

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 74 |
| character_builder.test.ts | 93 |
| character_leveler.test.ts | 232 |
| character_improvements.test.ts | 51 |
| server.test.ts | 157 |
| **Total** | **607** |

All 0 failures, full suite re-run after the change (no `.ts` files
were touched, only `docs/characters.html`, but ran for verification
per project testing standards). `tsc --noEmit -p .` clean — no new
errors introduced; pre-existing unrelated `TS7006` errors remain only
in untouched Cantrip-z spell test files (unchanged from
SHEET-HANDOVER-34's list).
