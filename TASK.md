# TASK.md

## ACTIVE WORKSTREAM

Core Engine

---

## ACTIVE OBJECTIVE

Implement remaining PHB 1st-level combat spell modules.

---

## CURRENT PHASE

Tier 1 PHB combat spell coverage — 1st-level spells for all classes represented in pc_stat_blocks_lv1.json.

---

## ACCEPTANCE CRITERIA

Objective is complete when:

* [ ] Shield implemented (Wizard/Sorcerer reaction, +5 AC, no concentration)
* [ ] Guiding Bolt implemented (Cleric ranged spell attack, 4d6 radiant, next attack has advantage)
* [ ] Healing Word implemented (Bard/Cleric bonus action heal 1d4+mod)
* [ ] All implemented spells have dedicated test suites passing 0 failures
* [ ] Full suite baseline maintained (0 persistent failures)

---

## CURRENT PRIORITIES

1. Shield (Wizard/Sorcerer reaction — +5 AC until next turn, no concentration)
2. Guiding Bolt (Cleric — ranged spell attack, 4d6 radiant, grants advantage on next hit)
3. Healing Word (Bard/Cleric — bonus action, 1d4+mod heal, 60 ft range)

---

## ACTIVE CONSTRAINTS

* Use testDataSpells/ as authoritative spell data source before implementing.
* Reuse established spell module architecture (shouldCast / execute / metadata pattern).
* Do NOT touch sheet routes, leveler.ts, or builder.ts.
* Spell DB key format: lowercase with spaces ('shield', 'guiding bolt').
* All inline enemy factories in tests must use loadBestiaryJson + monsterToCombatant pattern.
* PAT provided verbally at session start — do not paste in files.

---

## KNOWN BLOCKERS

None.
