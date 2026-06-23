# SHEET-HANDOVER-34
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `2f96e87`
- Repository state: clean, pushed (rebased onto Cantrip-27's megabatch
  commits, which landed mid-session — 186 files, all within
  src/spells/, src/engine/, src/ai/, src/test/<spell>.test.ts,
  spell-cache/; zero overlap with Sheet's files, zero conflicts)
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

### Dedicated TCE Artificer spell list — Session 2 of 3
- `class_spell_lists.ts`: added `'Artificer'` to `SpellcastingClassName`
  and a full `CLASS_SPELL_LISTS.Artificer` entry (cantrips + levels
  1–5; levels 6–9 are empty arrays, following the Paladin/Ranger
  half-caster convention). Removed the temporary
  `'Artificer': 'Wizard'` line from `CLASS_SPELL_LIST_ALIASES`.
- List built from 2014.5e.tools' generated spell/class lookup data
  (`gendata-spell-source-lookup.json` from the 5etools-2014-src repo,
  fetched via raw.githubusercontent.com), filtered to PHB/XGE/TCE
  sources only — matching this project's existing canon boundary and
  this file's own established precedent (no Spelljammer/Fizban's/AAG
  spells, even though those are technically pre-2024 WotC, since no
  other class list in this file draws from them either).
- Per existing precedent in this same file (other classes already
  include XGE "expanded spell list" spells as standard, not optional),
  XGE-introduced spells gained via the TCE Artificer feature are
  included directly: Absorb Elements, Catapult, Snare, Frostbite,
  Magic Stone, Thunderclap, Pyrotechnics, Skywrite, Catnap, Flame
  Arrows, Tiny Servant, Elemental Bane, Skill Empowerment, Transmute
  Rock, Create Bonfire.
- Final counts: 23 cantrips, 18/21/15/11/7 at levels 1–5 (95 total).
  Every name cross-checked against `testDataSpells/spells-*.json` for
  exact-match existence (case-sensitive) — zero misses.
- Added 4 tests to `server.test.ts` (`GET /api/spells?class=Artificer`
  at levels 0/1/5/6), confirming the dedicated list resolves directly
  (no longer via the Wizard alias) and that level 6 is correctly
  empty.

---

## DISCOVERIES RELEVANT TO NEXT TASK

- **No `classes` field in `testDataSpells/*.json`**: this repo's local
  spell DB is a stripped 5etools export with no class-list membership
  data at all (confirmed across every key in every spell entry). All
  `CLASS_SPELL_LISTS` entries in this codebase are hand-curated against
  external sourcebook data, not derivable from the local DB — only
  individual spell existence/level/etc. can be checked locally.
- 2014.5e.tools' raw data (via `raw.githubusercontent.com/5etools-mirror-3/5etools-2014-src/main/data/...`) is reachable from this
  container's network allowlist and is the most reliable source for
  class-spell-list membership going forward — specifically
  `data/generated/gendata-spell-source-lookup.json`, which maps
  `spell name → { class: { sourceOfListEntry: { ClassName: true } },
  classVariant: {...} }`. Note **`classVariant`** is used for spells
  XGE originally framed as supplemental "expanded list" entries — this
  project's existing precedent treats those as standard (not
  optional), confirmed by checking other classes' existing lists.
- `docs/characters.html` has no duplicated spell-list data — it fetches
  suggestions from `/api/spells?class=X` at runtime, so spell-list
  edits only ever need to touch `class_spell_lists.ts`.
- The pre-existing `docs/characters.html` parse bug from
  SHEET-HANDOVER-33 (duplicate `CLASS_SAVES` const, orphaned
  `showAddEquipForm` body) was not touched and is presumably still
  present — not re-verified this session, out of scope.
- Running `src/test/server.test.ts` mutates
  `characters/00000000-0000-0000-0000-000000000003.json` (`updatedAt`
  timestamp) as a side effect of PUT-endpoint tests. Revert this file
  with `git checkout` before committing if it shows as dirty.

---

## OPEN BLOCKERS

- None for Sheet.

---

## IMMEDIATE NEXT ACTION

Session 3 of the Artificer rollout: Artificer Specialist subclasses
(Alchemist, Armorer, Artillerist, Battle Smith) — TCE p.18–19 (and
errata). These were deliberately deferred from Sessions 1–2; no
subclass-feature scaffolding exists yet beyond the generic
level-3/6/9/14 subclass-choice placeholders already present in
`CLASS_FEATURES`. Audit actual subclass mechanical complexity
(Alchemist's formulas, Armorer's power armor modes, Artillerist's
eldritch cannon, Battle Smith's steel defender) before committing to
single-session scope — likely needs its own multi-session breakdown
similar to the original Artificer class estimate correction from
SHEET-HANDOVER-32.

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 74 |
| character_builder.test.ts | 93 |
| character_leveler.test.ts | 232 |
| character_improvements.test.ts | 51 |
| server.test.ts | 157 (was 153; +4 Artificer spell-list tests) |
| **Total** | **607** |

All 0 failures, verified pre-rebase and post-rebase (rebased onto
Cantrip-27's megabatch commits, zero conflicts — Cantrip-z's changes
don't touch any Sheet-owned file). `tsc --noEmit -p .` clean for all
Sheet-touched files (`class_spell_lists.ts`, `character_router.ts`,
`server.test.ts`); pre-existing unrelated `TS7006` errors remain only
in untouched Cantrip-z spell test files (catapult, chaos_bolt,
chromatic_orb, cone_of_cold, elemental_bane, enervation, fireball,
ice_knife, immolation, inflict_wounds, lightning_bolt, mind_spike,
negative_energy_flood, ray_of_sickness, spray_of_cards, vampiric_touch,
wardaway, witch_bolt).
