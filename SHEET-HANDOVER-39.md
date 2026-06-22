# SHEET-HANDOVER-39
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `ea59a67`
- Repository state: clean, pushed
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

All four open gaps from HANDOVER-38's functionality audit, implemented
and pushed as four separate commits (all Sheet-39 prefixed):

### Gap 1 — Missing per-rest class/race resource trackers (`6149dff`)

Nine resources that had explicit "X per rest" text but zero tracking:
Fighter Indomitable (1/2/3 uses @lv9/13/17, long rest), Paladin
Cleansing Touch (CHA-mod @lv14, long rest), Warlock Mystic Arcanum (4
independent optional booleans — `undefined` = not yet unlocked, `true`
= available, `false` = used — unlocked individually @lv11/13/15/17,
long rest), Wizard Spell Mastery (2 uses @lv18, long rest), Artificer
Flash of Genius (INT-mod @lv7), Spell-Storing Item (2 @lv11), Soul of
Artifice (1 @lv20), Dragonborn Breath Weapon (short or long rest), and
Half-Orc Relentless Endurance (long rest).

New `initRaceResources()` helper called once at first level-up
(`currentTotal === 0`) for race-granted resources. Wired into both
rest endpoints and the UI resource button row. Caught and fixed a
real bug: the first Mystic Arcanum implementation force-defaulted
not-yet-unlocked levels to `false` instead of `undefined`, making
l7/l8/l9 silently fail to unlock — caught by 4 of the 30 new unit
tests before commit.

### Gap 2 — Attunement tracking (`838910b`)

`EquipmentItem.attuned?: boolean` + `magical?: boolean`. New helpers
`attunementCap(sheet)` (3 base; 4/5/6 at Artificer lv10/14/18 via
Magic Item Adept/Savant/Master) and `attunedItemCount(sheet)`.
Validator now rejects saves where attuned count exceeds the cap.
Equipment table gets an "Attuned" toggle column (⭑/☆ buttons). The
All Gear header shows "Attuned: X/Y" in red when over cap.

### Gap 3 — Carrying capacity / item weight (`a7fe7f2`)

`EquipmentItem.weight?: number` (lb per unit). New helpers
`carryingCapacity(sheet)` (STR × 15) and `totalCarriedWeight(sheet)`
(sum of weight × qty; missing weight contributes 0). Equipment table
gets a "Wt" column (number input, step 0.1). The gear header shows
"Carried: X/Y lb" in red when over cap.

### Gap 4 — Spell choices for spell-granting feats (`ea59a67`)

Magic Initiate / Ritual Caster / Spell Sniper were already flagged
`grantsSpells: true` in the feat registry but had no place to store
which spells were chosen. Added `CharacterSheet.featSpellChoices?:
Record<string, string[]>` and a new `POST
/characters/:id/setfeatspells` endpoint. The `applyfeat` response now
includes `grantsSpells: boolean`; when true the UI shows a follow-up
panel to enter chosen spell names. Already-recorded choices appear
inline in the feature list with an [edit] link.

---

## DISCOVERIES RELEVANT TO NEXT TASK

- Upstream landed several Cantrip-z and Core Engine commits across
  multiple rebases this session (Thirsting Blade flakiness fix,
  zHANDOVER-42, etc.) — all rebases were clean with zero Sheet-file
  overlap.
- The server.test.ts POST-body character-creation fixture must use
  `"True Neutral"` not `"Neutral"` — the validator's VALID_ALIGNMENTS
  set requires the full PHB string. Bit us on the setfeatspells setup
  test; documented here to save time in future server tests.
- `server.test.ts` uses `assert(cond, msg)` (condition first),
  while `character_*.test.ts` suites use `assert(label, cond)` (label
  first). The mismatch caused a TS2345 type error that was easy to
  spot but worth knowing upfront.
- `_featData` is now cached on `window` after the first `renderCharDetail`
  call that fires while `S.feats` is populated (via `ensureFeatsLoaded`).
  The cache is used for the `grantsSpells` badge in the feature list.
  If S.feats hasn't been loaded yet (user never opened the feat panel),
  the badge won't appear — acceptable behaviour, lazy load is fine.

---

## OPEN BLOCKERS

None for Sheet. All four queued audit gaps are now closed.

---

## IMMEDIATE NEXT ACTION

No Sheet work queued. Check TEAMGOALS.md for new Sheet-tagged items
or get a new objective from Ares.

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 89 (was 84; +5 carrying capacity) |
| character_builder.test.ts | 93 |
| character_leveler.test.ts | 256 (was 232; +24 resource tracker) |
| character_improvements.test.ts | 108 (was 100; +8 feat spell flags) |
| server.test.ts (via `timeout 120`) | 176 (was 166; +10 rest/feat/setfeatspells) |
| **Total** | **722** |

All 0 failures. `npx tsc --noEmit -p .` clean (0 errors).
Reverted `characters/00000000-0000-0000-0000-000000000003.json` before
each commit, per standard protocol.
