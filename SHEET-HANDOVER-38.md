# SHEET-HANDOVER-38
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `4d53f9d`
- Repository state: clean, pushed
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

Followed up the prior session's TEAMGOALS.md audit (HANDOVER-37) with a
functionality-gap audit of character sheets/creation/leveling/rest/equipment
at Ares's request. Found ~6 real gaps; Ares selected two to fix this session.

### 1. Temp HP damage absorption (`cec3ffa`)

`applyHPAmt('dmg')` in `characters.html` subtracted straight from
`currentHP` and never touched `temporaryHP` — PHB p.198 requires damage to
deplete temp HP first, with only the leftover hitting real HP. Extracted a
pure `computeDamageHP(currentHP, maxHP, tempHP, amount)` helper and wired it
into the damage button; healing is unaffected (heals never touch temp HP).
Validated with 6 standalone node test cases before committing (full absorb,
partial absorb + carryover, no temp HP, exact match, overkill floors at 0,
negative-input defense). `setHPDirect` (the raw "set HP to X" override field)
was intentionally left untouched — it's a correction tool, not a "take
damage" action.

### 2. Feat-instead-of-ASI system (`4d53f9d`)

PHB p.165 lets a character take a feat instead of an ASI; there was
previously no way to do this at all (`applyasi` only took ability+amount,
and `feats: string[]` had no registry behind it).

- **`src/characters/feat_data.ts`** (new) — all 42 PHB 2014 feats, pulled
  from the 5etools PHB mirror (`raw.githubusercontent.com/5etools-mirror-3/
  5etools-2014-src/main/data/feats.json`, filtered to `source: "PHB"`) rather
  than relying on memory. Each feat has name/prerequisite/full description,
  plus sheet-applicable mechanical hooks where they exist: ability score
  bump (fixed or player-choice), Resilient's matching saving-throw prof,
  Skilled's 3 skill/tool picks, Linguist's 3 languages, the three Armored
  feats' armor-proficiency grant, Tough's +2 HP/level. Combat-only feats
  (Great Weapon Master, Sharpshooter, Polearm Master, Sentinel, etc.) are
  listed in full but apply no sheet-side number on purpose — that's Core
  Engine's combat-resolution territory, not the persisted sheet. Magic
  Initiate/Ritual Caster/Spell Sniper are flagged `grantsSpells: true` but
  not auto-resolved (no spell-picker UI exists yet) — documented as a known
  follow-up, not a silent gap.
- **`applyFeat()`** in `improvements.ts` — mirrors `applyASI`'s exact ASI
  half-point accounting. Validates: duplicate feats blocked (Elemental
  Adept is the sole PHB exception, explicitly allowed to repeat), 20-score
  cap, skill-name validity, exact choice counts.
- **`leveler.ts`** — Tough's future-level +2 is folded directly into the
  existing `hpGained` value computed in `applyLevelUp`, so `popLevel`'s
  existing `record.hpGained` subtraction reverses it automatically. No new
  reversal machinery needed.
- **New endpoints**: `GET /api/feats`, `POST /characters/:id/applyfeat`.
- **UI**: the ASI panel now has a "Raise a Score" / "Take a Feat instead"
  toggle; the feat panel shows prerequisite + description and renders
  ability-choice / skill-multiselect / language-text inputs dynamically
  based on which hooks the selected feat has.

**Known limitation (documented in code, not silent):** taking a feat isn't
recorded in `levelHistory`, so `popLevel()` can't undo a feat choice. This
matches the pre-existing behavior of `chooseSubclass` (also not
stack-reversible) rather than introducing a new category of gap. Full undo
support would need `LevelRecord` extended to snapshot
proficiencies/languages/feats — out of scope for this pass, flagged as a
follow-up if it's ever wanted.

---

## DISCOVERIES RELEVANT TO NEXT TASK

- Upstream landed a large batch of Cantrip-z/Core Engine work mid-session
  (TG-006 Summon subsystem Phases 1-4, complete; TG-008 Reaction spells,
  complete; a full TS-error cleanup 124→0). Rebased cleanly onto it (no
  Sheet-file overlap) before pushing — `npx tsc --noEmit -p .` is now fully
  clean project-wide (0 errors, the old witch_bolt.test.ts TS7006 baseline
  is gone too).
- `git add -p` works fine for splitting a single HTML file into separate
  commits when the changed regions are far apart in the file (6 hunks here,
  cleanly separable into the 2 unrelated features by hunk line-range).
- The 5etools mirror's `feats.json` mixes every sourcebook (Eberron,
  Strixhaven, MTG sets, etc.) in one file — must filter `source === "PHB"`
  to get the canonical 42. Same mirror/fetch pattern as spells, just a
  different top-level key (`feat` not `spell`).

---

## OPEN BLOCKERS

- None for Sheet.

---

## IMMEDIATE NEXT ACTION

Four gaps from the audit are still open, all confirmed real and Sheet-owned
(not yet prioritized by Ares):

1. Several "X per rest" class/race features have zero resource tracking —
   Fighter Indomitable, Paladin Cleansing Touch, Warlock Mystic Arcanum,
   Wizard Spell Mastery, Artificer Flash of Genius/Spell-Storing
   Item/Soul of Artifice, Dragonborn Breath Weapon, Half-Orc Relentless
   Endurance. No `CharacterResources` field, no `updateResources()` init,
   no rest-recharge entry for any of these.
2. No attunement tracking — `EquipmentItem` has no `attuned`/`magical`
   field; the 3-slot cap (4/5/6 for Artificer) is unenforced, and Soul of
   Artifice (+1 save per attuned item) can't be computed as a result.
3. No carrying capacity / item weight (`EquipmentItem` has no `weight`
   field; STR×15 capacity, PHB p.176, isn't computed anywhere). Lower
   priority — many tables ignore this rule.
4. Magic Initiate / Ritual Caster / Spell Sniper spell grants aren't
   auto-resolved (flagged via `grantsSpells` in the new feat registry, but
   no spell-picker UI exists to let the player choose which spells).

Get direction from Ares on which (if any) to pick up next, or check
TEAMGOALS.md for a new Sheet-tagged item.

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 74 |
| character_builder.test.ts | 93 |
| character_leveler.test.ts | 232 |
| character_improvements.test.ts | 100 (was 58; +42 new applyFeat tests) |
| server.test.ts (via `timeout 120`) | 166 (was 157; +9 new feat endpoint tests) |
| **Total** | **665** |

All 0 failures. `npx tsc --noEmit -p .` fully clean (0 errors project-wide).
Reverted `characters/00000000-0000-0000-0000-000000000003.json` (server.test.ts
PUT-test mutation) before each commit, per standard protocol.
