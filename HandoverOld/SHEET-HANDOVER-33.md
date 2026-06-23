# SHEET-HANDOVER-33
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `bced446`
- Repository state: clean, pushed (rebased onto Cantrip-24's
  Batch-1-complete commits, which landed mid-session)
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

### Artificer class registration + spell-slot progression (TCE) — Session 1 of 3
- `ClassName` now includes `'Artificer'`, wired into every mandatory
  `Record<ClassName,...>` table: `CLASS_HIT_DICE` (d8),
  `MULTICLASS_PREREQS` (INT 13), `SUBCLASS_LEVELS` (3rd),
  `ASI_LEVELS` (4/8/12/16/19), `CLASS_STAT_PRIORITY`
  (`stat_optimizer.ts`), plus `VALID_CLASSES` guards in both
  `leveler.ts` and `validator.ts`.
- New `ARTIFICER_SLOTS` table (`leveler.ts`, exported): Artificer gains
  spellcasting at 1st level (TCE p.16), unlike Paladin/Ranger at 2nd, so
  it needed its own table rather than reusing `HALF_CASTER_SLOTS`.
  `computeStandardSlots()` now special-cases Artificer: dedicated table
  when it's the sole spellcasting class; `ceil(level/2)` contribution
  (vs. `floor` for Paladin/Ranger) when multiclassing, per TCE p.11's
  explicit rounding-up exception for Artificer.
- `CASTING_ABILITY` = INT; added core (non-Specialist) `CLASS_FEATURES`
  at levels 1, 2, 3 (generic subclass-choice placeholder — same pattern
  every other class uses, no Specialist mechanics), 6, 7, 10, 11, 14,
  18, 20.
- `class_spell_lists.ts`: aliased `Artificer → Wizard` spell list
  (temporary stand-in via the existing `CLASS_SPELL_LIST_ALIASES`
  mechanism, same as EK/AT — replace with a dedicated TCE list next
  session).
- `docs/characters.html`: Artificer added to all class
  dropdowns/datalists (creation wizard, legacy form, multiclass-add),
  `CLASS_HD`/`CLASS_SAVES`/`CLASS_WEAPON_PROFS`/`CLASS_ARMOR_PROFS`/
  `CLASS_SKILLS`/`CLASS_RESOURCES_L1` (both declared copies of
  `CLASS_HD`+`CLASS_SAVES` — see discovery below), the `SPELLCASTERS`
  set in `_resolveSpellcastingClasses`, and `onClassChange`'s
  equipment-defaults map.
- 25 new tests added to `character_leveler.test.ts`: `ARTIFICER_SLOTS`
  data integrity, `computeStandardSlots` (single-class + multiclass
  ceil-vs-floor rounding), and full `applyLevelUp` flow (lv1
  spellcasting active immediately, d8 hit die, ASI at 4, subclass
  prompt at 3, INT-13 multiclass prereq).
- Deliberately deferred (next sessions, per the plan from
  SHEET-HANDOVER-32): dedicated TCE Artificer spell list, Artificer
  Specialist subclass features, and the Infusion resource system
  (Infuse Item is listed in `CLASS_FEATURES` as flavor text only, no
  backing mechanical resource).

---

## DISCOVERIES RELEVANT TO NEXT TASK

- **Bug found & fixed this session**: `applyLevelUp`'s
  `hasStandardCasterClass` gate only checked `FULL_CASTERS`/
  `HALF_CASTERS` set membership, so a pure single-class Artificer never
  got a `spellcasting` block initialized (silently produced zero slots
  forever). Fixed by also checking `cl.className === 'Artificer'`.
  Worth remembering if any future class is added outside the two
  existing caster sets.
- **Pre-existing, unrelated bug in `docs/characters.html`**: the file
  has a duplicate top-level `const CLASS_SAVES` declaration (lines
  ~840 and ~2475) and an orphaned function body (missing
  `function showAddEquipForm(charId) {` header before its content,
  around the `hideAddEquipForm` definition) that together make the
  inline script fail to parse as valid JS/TS from that point onward.
  Confirmed present in `HEAD` before this session's edits (not
  introduced by this work) via a one-off `tsc --noEmit` check on the
  extracted `<script>` block. Not fixed — out of scope for Artificer
  work — but flagged since it blocks any future full-file static
  validation until patched.
- TCE's Artificer multiclassing rule (half-levels round **up**, not
  down) is unique among half-casters — confirmed directly from the
  original 2020 TCE text, not a 2024-revision artifact. Already
  implemented; just worth knowing if extending multiclass math further.

---

## OPEN BLOCKERS

- None for Sheet.

---

## IMMEDIATE NEXT ACTION

Session 2 of the Artificer rollout: build the dedicated TCE Artificer
spell list in `class_spell_lists.ts` (cantrips + levels 1–5, TCE p.20–21)
as a proper `SpellcastingClassName` entry, then remove the temporary
`'Artificer': 'Wizard'` alias. Follow the existing `CLASS_SPELL_LISTS`
data shape used by the other 8 caster classes. Session 3 (later):
Artificer Specialist subclasses (Alchemist/Armorer/Artillerist/Battle
Smith).

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 74 |
| character_builder.test.ts | 93 |
| character_leveler.test.ts | 232 (was 207; +25 Artificer tests) |
| character_improvements.test.ts | 51 |
| server.test.ts | 153 |
| **Total** | **603** |

All 0 failures, verified pre-rebase and post-rebase (rebased onto
Cantrip-24's Batch-1-complete commits, zero conflicts). `tsc --noEmit`
clean for all Sheet-owned `.ts` files (pre-existing unrelated errors
only in Cantrip-z spell test files, untouched).
