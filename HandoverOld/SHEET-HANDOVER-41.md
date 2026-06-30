# SHEET-HANDOVER-41
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `2ea3659`
- Repository state: clean, pushed
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

Three sequential increments closing the remaining audit gaps. Each committed separately.

### Sheet-41a — Full currency (`4332e25`)
`CharacterSheet` gains `cp?/sp?/ep?/pp?` optional fields (PHB p.143).
Creation init sets all four to 0. Single gold input replaced with a 5-denomination
currency row (cp/sp/ep/gp/pp) in `renderEquipment()`. `saveGold()` replaced by
`saveCurrency()` sending all five via PUT. Creation form, edit-populate, and
`newChar()` reset updated to match.

### Sheet-41b — Temporary ability score overrides (`4f31534`)
`CharacterSheet.tempStatOverrides?: Partial<Record<AbilityScore, number>>`.
`POST /characters/:id/settempstats` — merge-patch semantics: number sets, null
clears, omitted keys unchanged; validates key names and range 1–30.
Ability score cells in the detail view are now clickable; overridden scores render
in accent2 colour with ★. `openTempStatPanel()` / `doSetTempStat()` provide
set + clear via inline modal. +10 server tests (197→207).

### Sheet-41c — AC auto-update on equip (`2ea3659`)
`PHB_ARMOR_AC` table (all 12 PHB p.144–145 armor types) and `computeArmorAC()`
helper added to `character_router.ts`. `/equip` endpoint now recomputes
`armorClass`/`acFormula` when an armor or shield is toggled; response includes
`acUpdated: boolean`. Unknown armor names return null (manually-set AC preserved).
`toggleEquip()` in the UI calls `renderCharDetail()` when `acUpdated` is true so
the AC stat box refreshes immediately. +8 server tests (207→215).

---

## DISCOVERIES RELEVANT TO NEXT TASK

- `computeArmorAC` only fires when category is `'armor'` or `'shield'`; items
  with other categories (weapon, gear, etc.) set `acUpdated: false`. This is
  correct behaviour — preserve it.
- Unarmored + shield toggle uses `10 + DEX mod + 2` as the formula. If a character
  has a class feature that changes their unarmored AC (Barbarian, Monk), equipping
  or unequipping a shield will incorrectly use the formula base of 10. This is a
  known gap; a follow-up would need a per-class unarmored-AC hook.

---

## OPEN BLOCKERS

None.

---

## IMMEDIATE NEXT ACTION

No Sheet work queued. Check TEAMGOALS.md for new Sheet-tagged items or get a
new objective from Ares.

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 89 |
| character_leveler.test.ts | 256 |
| character_improvements.test.ts | 108 |
| server.test.ts | 215 |
| **Total** | **668** |

All 0 failures. `tsc --noEmit` clean.
