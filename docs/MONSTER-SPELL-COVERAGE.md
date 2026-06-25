# Monster Spell Coverage Report

Generated: `2026-06-25T16:39:01.017Z`
Source: 2401 bestiary entries from `bestiaryData/`, scanned via `scripts/scan_monster_spells.ts`.

> **Purpose:** This report guides which spell modules to build next for the
> Monster Spellcasting engine (`src/ai/monster_spellcasting.ts`). Spells used by
> many creatures but not yet implemented are the highest-value targets — each
> new module unlocks AI behavior for every creature that knows it.
>
> **Regenerate** after implementing new spells: `npx ts-node --transpile-only scripts/scan_monster_spells.ts`

## Summary

| Metric | Value |
|--------|-------|
| Total creatures in bestiary | 2401 |
| Creatures with `monsterSpellcasting` | 775 (32.3%) |
| Total spell references (incl. duplicates) | 6136 |
| Unique spells referenced | 454 |
| ├─ Already implemented | 298 (65.6%) |
| └─ NOT yet implemented | 156 (34.4%) |

## Top 50 Unbuilt Spells (by creature frequency)

Priority for future spell-module work. Each row lists the spell name, the number
of distinct creatures that know it, total references (a creature may list the same
spell at multiple slot levels — counted separately), and a few example creatures.

| Rank | Spell | # Creatures | Total Refs | Example Creatures | Notes |
|------|-------|-------------|------------|-------------------|-------|
| 1 | Detect Magic | 179 | 179 | Factol Skall, Flabbergast, Pendragon Beestinger | `PHB` · Divination · levels: atWill/daily,L1 |
| 2 | Plane Shift | 80 | 80 | Factol Skall, Tyreus, Illusionist, Exul | `PHB` · Conjuration · levels: atWill/daily,L7 |
| 3 | Sending | 41 | 41 | Aartuk Elder, Astral Elf Aristocrat, Astral Elf Star Priest | `PHB` · Evocation · levels: atWill/daily,L3 |
| 4 | Teleport | 37 | 37 | Astral Elf Commander, Bel, Hollyphant | `PHB` · Conjuration · levels: atWill/daily,L7 |
| 5 | Tongues | 36 | 36 | Exul, Morwena Veilmist, Githyanki Star Seer | `PHB` · Divination · levels: atWill/daily,L3 |
| 6 | Detect Evil and Good | 34 | 34 | Heralds of Dust Exorcist, Saleeth the Couatl, Krull | `PHB` · Divination · levels: atWill/daily,L1 |
| 7 | Protection from Evil and Good | 27 | 27 | Heralds of Dust Exorcist, Hollyphant, Skull Lasher of Myrkul | `PHB` · Abjuration · levels: atWill/daily,L1 |
| 8 | Animate Dead | 24 | 24 | Factol Skall, Arkhan the Cruel, Krull | `PHB` · Necromancy · levels: atWill/daily,L3 |
| 9 | Revivify | 24 | 24 | Aartuk Starhorror, Arkhan the Cruel, Asteria | `PHB` · Necromancy · levels: atWill/daily,L3 |
| 10 | Comprehend Languages | 23 | 23 | Exul, Master Sage, Sage | `PHB` · Divination · levels: atWill/daily,L1 |
| 11 | True Seeing | 20 | 20 | Krull, Mahadi the Rakshasa, Master Sage | `PHB` · Divination · levels: atWill/daily,L6 |
| 12 | Divination | 19 | 19 | Astral Elf Star Priest, Krull, Fate Hag | `PHB` · Divination · levels: atWill/daily,L4 |
| 13 | Clairvoyance | 18 | 18 | Valin Sarnaster, Ezmerelda d'Avenir, Kalaraq Quori | `PHB` · Divination · levels: atWill/daily,L3 |
| 14 | Dispel Evil and Good | 15 | 15 | Heralds of Dust Exorcist, Omin Dran, Kostchtchie | `PHB` · Abjuration · levels: atWill/daily,L5 |
| 15 | Locate Object | 15 | 15 | Master Sage, Sage, Mephistopheles | `PHB` · Divination · levels: atWill/daily,L2 |
| 16 | Arcane Eye | 13 | 13 | Morwena Veilmist, Zythan, Lohezet | `PHB` · Divination · levels: atWill/daily,L4 |
| 17 | Identify | 13 | 13 | Master Sage, Sage, Monastic High Curator | `PHB` · Divination · levels: atWill/daily,L1 |
| 18 | Augury | 11 | 11 | Auspicia Dran, Rictavio, Anchorite of Talos | `PHB` · Divination · levels: atWill/daily,L2 |
| 19 | Locate Creature | 11 | 11 | Omin Dran, Krull, Euryale | `PHB` · Divination · levels: atWill/daily,L4 |
| 20 | Water Breathing | 11 | 11 | Alyxian the Absolved, Galsariad Ardyth (Tier 3), Amble | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 21 | Longstrider | 9 | 9 | K'Tulah, Galsariad Ardyth (Tier 1), Galsariad Ardyth (Tier 2) | `PHB` · Transmutation · levels: atWill/daily,L1 |
| 22 | Dream | 8 | 8 | Saleeth the Couatl, Cloud Giant Destiny Gambler, Dusk Hag | `PHB` · Illusion · levels: atWill/daily |
| 23 | Water Walk | 8 | 8 | Pharblex Spattergoo, Verbeeg Longstrider, Empyrean | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 24 | Commune | 7 | 7 | Jenevere, Radiant Idol, Pari | `PHB` · Divination · levels: atWill/daily |
| 25 | Legend Lore | 6 | 6 | Omin Dran, Master Sage, Jenevere | `PHB` · Divination · levels: atWill/daily,L5 |
| 26 | [object Object] | 5 | 8 | Zodar, Lichen Lich, Master Sage | levels: atWill/daily |
| 27 | Awaken | 4 | 4 | Yarnspinner, Frost Druid, The Gardener | `PHB` · Transmutation · levels: atWill/daily,L5 |
| 28 | Contact Other Plane | 4 | 4 | Githyanki Star Seer, Master Sage, Shemeshka | `PHB` · Divination · levels: atWill/daily |
| 29 | Imprisonment | 4 | 4 | Bel, Isperia, Manshoon | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 30 | Conjure Elemental* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L5 |
| 31 | Evard's Black Tentacles* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L4 |
| 32 | Gentle Repose | 3 | 3 | Krull, Koh Tam, Lampad | `PHB` · Necromancy · levels: atWill/daily,L2 |
| 33 | Heroes' Feast | 3 | 3 | Jaheira, Androsphinx, The Gardener | `PHB` · Conjuration · levels: atWill/daily,L6 |
| 34 | Locate Animals or Plants | 3 | 3 | Barbatos, Zuggtmoy, Jarl Storvald | `PHB` · Divination · levels: atWill/daily,L2 |
| 35 | Mage Armor* | 3 | 3 | Prisoner 237, Archmage, Abjurer | levels: L1 |
| 36 | Mirror Image* | 3 | 3 | Tyreus, Illusionist, Gar Shatterkeel, Illusionist | levels: L2 |
| 37 | Misty Step* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L2 |
| 38 | Programmed Illusion | 3 | 3 | Baba Lysaga, Fraz-Urb'luu, Halaster Blackcloak | `PHB` · Illusion · levels: atWill/daily,L6 |
| 39 | Suggestion* | 3 | 3 | Morwena Veilmist, Prisoner 237, Enchanter | levels: L2 |
| 40 | Unseen Servant* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L1 |
| 41 | Wind Wall | 3 | 3 | Frost Druid, Triton Master of Waves, Asharra | `PHB` · Evocation · levels: atWill/daily,L3 |
| 42 | Animate Dead* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L3 |
| 43 | Arcane Lock* | 2 | 2 | Prisoner 237, Abjurer | levels: L2 |
| 44 | Astral Projection | 2 | 2 | Sarevok, Pazuzu | `PHB` · Necromancy · levels: atWill/daily |
| 45 | Blight* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L4 |
| 46 | Charm Person* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L1 |
| 47 | Cloud of Daggers* | 2 | 2 | Malivar, Conjurer | levels: L2 |
| 48 | Cloudkill* | 2 | 2 | Tarul Var, Conjurer | levels: L5 |
| 49 | Cone of Cold* | 2 | 2 | Malivar, Evoker | levels: L5 |
| 50 | Detect Thoughts* | 2 | 2 | Prisoner 237, Diviner | levels: L2 |

## Full Unbuilt Spells List (all)

| Rank | Spell | # Creatures | Total Refs |
|------|-------|-------------|------------|
| 1 | Detect Magic | 179 | 179 |
| 2 | Plane Shift | 80 | 80 |
| 3 | Sending | 41 | 41 |
| 4 | Teleport | 37 | 37 |
| 5 | Tongues | 36 | 36 |
| 6 | Detect Evil and Good | 34 | 34 |
| 7 | Protection from Evil and Good | 27 | 27 |
| 8 | Animate Dead | 24 | 24 |
| 9 | Revivify | 24 | 24 |
| 10 | Comprehend Languages | 23 | 23 |
| 11 | True Seeing | 20 | 20 |
| 12 | Divination | 19 | 19 |
| 13 | Clairvoyance | 18 | 18 |
| 14 | Dispel Evil and Good | 15 | 15 |
| 15 | Locate Object | 15 | 15 |
| 16 | Arcane Eye | 13 | 13 |
| 17 | Identify | 13 | 13 |
| 18 | Augury | 11 | 11 |
| 19 | Locate Creature | 11 | 11 |
| 20 | Water Breathing | 11 | 11 |
| 21 | Longstrider | 9 | 9 |
| 22 | Dream | 8 | 8 |
| 23 | Water Walk | 8 | 8 |
| 24 | Commune | 7 | 7 |
| 25 | Legend Lore | 6 | 6 |
| 26 | [object Object] | 5 | 8 |
| 27 | Awaken | 4 | 4 |
| 28 | Contact Other Plane | 4 | 4 |
| 29 | Imprisonment | 4 | 4 |
| 30 | Conjure Elemental* | 3 | 3 |
| 31 | Evard's Black Tentacles* | 3 | 3 |
| 32 | Gentle Repose | 3 | 3 |
| 33 | Heroes' Feast | 3 | 3 |
| 34 | Locate Animals or Plants | 3 | 3 |
| 35 | Mage Armor* | 3 | 3 |
| 36 | Mirror Image* | 3 | 3 |
| 37 | Misty Step* | 3 | 3 |
| 38 | Programmed Illusion | 3 | 3 |
| 39 | Suggestion* | 3 | 3 |
| 40 | Unseen Servant* | 3 | 3 |
| 41 | Wind Wall | 3 | 3 |
| 42 | Animate Dead* | 2 | 2 |
| 43 | Arcane Lock* | 2 | 2 |
| 44 | Astral Projection | 2 | 2 |
| 45 | Blight* | 2 | 2 |
| 46 | Charm Person* | 2 | 2 |
| 47 | Cloud of Daggers* | 2 | 2 |
| 48 | Cloudkill* | 2 | 2 |
| 49 | Cone of Cold* | 2 | 2 |
| 50 | Detect Thoughts* | 2 | 2 |
| 51 | False Life* | 2 | 2 |
| 52 | Find the Path | 2 | 2 |
| 53 | Fire Bolt* | 2 | 2 |
| 54 | Hold Monster* | 2 | 2 |
| 55 | Hold Person* | 2 | 2 |
| 56 | Invisibility* | 2 | 2 |
| 57 | Light* | 2 | 2 |
| 58 | Lightning Bolt* | 2 | 2 |
| 59 | Magic Missile* | 2 | 2 |
| 60 | Major Image* | 2 | 2 |
| 61 | Phantasmal Force* | 2 | 2 |
| 62 | Phantasmal Killer* | 2 | 2 |
| 63 | Prismatic Wall | 2 | 2 |
| 64 | ray of Enfeeblement* | 2 | 2 |
| 65 | ray of Sickness* | 2 | 2 |
| 66 | Resurrection | 2 | 2 |
| 67 | Shocking Grasp* | 2 | 2 |
| 68 | Simulacrum | 2 | 2 |
| 69 | Stoneskin* | 2 | 2 |
| 70 | Vampiric Touch* | 2 | 2 |
| 71 | Wall of Thorns | 2 | 2 |
| 72 | Web* | 2 | 2 |
| 73 | Word of Recall | 2 | 2 |
| 74 | Abi-dalzim's Horrid Wilting* | 1 | 1 |
| 75 | Acid Splash * | 1 | 1 |
| 76 | Acid Splash* | 1 | 1 |
| 77 | Alarm* | 1 | 1 |
| 78 | Alter Self* | 1 | 1 |
| 79 | Arcane Eye* | 1 | 1 |
| 80 | Banishment* | 1 | 1 |
| 81 | Bestow Curse* | 1 | 1 |
| 82 | Bigby's Hand* | 1 | 1 |
| 83 | Blindness/deafness* | 1 | 1 |
| 84 | Blink* | 1 | 1 |
| 85 | Burning Hands* | 1 | 1 |
| 86 | Chain Lightning* | 1 | 1 |
| 87 | Chaos Bolt* | 1 | 1 |
| 88 | Circle of Death* | 1 | 1 |
| 89 | Clairvoyance* | 1 | 1 |
| 90 | Clone | 1 | 1 |
| 91 | Color Spray* | 1 | 1 |
| 92 | Command * | 1 | 1 |
| 93 | Confusion * | 1 | 1 |
| 94 | Contingency | 1 | 1 |
| 95 | Control Water* | 1 | 1 |
| 96 | Counterspell* | 1 | 1 |
| 97 | Demiplane | 1 | 1 |
| 98 | Detect Magic* | 1 | 1 |
| 99 | Detect Poison and Disease | 1 | 1 |
| 100 | Detect Thoughts * | 1 | 1 |
| 101 | Dimension Door* | 1 | 1 |
| 102 | Disguise Self* | 1 | 1 |
| 103 | Dispel Magic* | 1 | 1 |
| 104 | Distort Value* | 1 | 1 |
| 105 | Dominate Beast* | 1 | 1 |
| 106 | Dominate Monster * | 1 | 1 |
| 107 | Drawmij's Instant Summons | 1 | 1 |
| 108 | Enervation* | 1 | 1 |
| 109 | Expeditious Retreat* | 1 | 1 |
| 110 | Fast Friends* | 1 | 1 |
| 111 | Finger of Death* | 1 | 1 |
| 112 | Fireball* | 1 | 1 |
| 113 | Flaming Sphere* | 1 | 1 |
| 114 | Forbiddance | 1 | 1 |
| 115 | Freedom of Movement* | 1 | 1 |
| 116 | Gift of Gab* | 1 | 1 |
| 117 | Globe of Invulnerability* | 1 | 1 |
| 118 | Hallucinatory Terrain* | 1 | 1 |
| 119 | ice Storm* | 1 | 1 |
| 120 | Illusory Script | 1 | 1 |
| 121 | Incite Greed* | 1 | 1 |
| 122 | Jim's Glowing Coin* | 1 | 1 |
| 123 | Jim's Magic Missile* | 1 | 1 |
| 124 | Knock* | 1 | 1 |
| 125 | Locate Object* | 1 | 1 |
| 126 | Magic Missile * | 1 | 1 |
| 127 | Mental Prison* | 1 | 1 |
| 128 | Message* | 1 | 1 |
| 129 | Mind Blank* | 1 | 1 |
| 130 | Mislead* | 1 | 1 |
| 131 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 |
| 132 | Phantom Steed* | 1 | 1 |
| 133 | Planar Ally | 1 | 1 |
| 134 | Planar Binding | 1 | 1 |
| 135 | Polymorph* | 1 | 1 |
| 136 | Rary's Telepathic Bond* | 1 | 1 |
| 137 | ray of Frost* | 1 | 1 |
| 138 | Rope Trick | 1 | 1 |
| 139 | Scrying* | 1 | 1 |
| 140 | Sending * | 1 | 1 |
| 141 | Shapechange | 1 | 1 |
| 142 | Shatter* | 1 | 1 |
| 143 | Shield* | 1 | 1 |
| 144 | Shocking Grasp * | 1 | 1 |
| 145 | Slow* | 1 | 1 |
| 146 | Stinking Cloud* | 1 | 1 |
| 147 | Symbol* | 1 | 1 |
| 148 | Telekinesis* | 1 | 1 |
| 149 | Telepathy | 1 | 1 |
| 150 | Thunder Step* | 1 | 1 |
| 151 | Thunderclap* | 1 | 1 |
| 152 | True Seeing* | 1 | 1 |
| 153 | Wall of Ice* | 1 | 1 |
| 154 | Water Breathing* | 1 | 1 |
| 155 | Water Walk* | 1 | 1 |
| 156 | Wish* | 1 | 1 |

## Implemented Spells (already built — summary)

| Level | Implemented count |
|-------|-------------------|
| unknown | 27 |
| 0 | 33 |
| 1 | 51 |
| 2 | 55 |
| 3 | 37 |
| 4 | 30 |
| 5 | 27 |
| 6 | 14 |
| 7 | 11 |
| 8 | 9 |
| 9 | 4 |

## Methodology

1. **Bestiary scan**: iterates every JSON in `bestiaryData/`, parses each
   creature's 5etools `spellcasting` block, and collects spell names from the
   `will` (at-will), `daily`, and `spells` (slot-based, levels 0–9) fields.
   `@spell` tags are stripped, parentheticals like `(self only)` are removed.

2. **Implementation check**: a spell is "implemented" if EITHER:
   - it appears in `spell-cache/level-*.json` with `implemented: true` (i.e. has
     a module in `src/spells/<name>.ts` registered via `_generic_registry.ts` or a
     dedicated `case` in `combat.ts`), OR
   - it appears in `CANTRIP_TEMPLATES` in `src/ai/monster_spellcasting.ts` (the
     monster-only combat cantrip templates handled directly by the monster
     spellcasting engine — these are not in the spell cache).

3. **Frequency**: creature count is the number of distinct creatures that list
   the spell in any field. Total refs includes duplicates when a creature lists
   the same spell at multiple slot levels.
