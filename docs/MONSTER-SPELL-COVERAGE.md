# Monster Spell Coverage Report

Generated: `2026-06-25T05:37:59.060Z`
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
| ├─ Already implemented | 283 (62.3%) |
| └─ NOT yet implemented | 171 (37.7%) |

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
| 12 | Wall of Force | 20 | 20 | Miirym, Lohezet, The Lord of Blades | `PHB` · Evocation · levels: atWill/daily,L5 |
| 13 | Divination | 19 | 19 | Astral Elf Star Priest, Krull, Fate Hag | `PHB` · Divination · levels: atWill/daily,L4 |
| 14 | Clairvoyance | 18 | 18 | Valin Sarnaster, Ezmerelda d'Avenir, Kalaraq Quori | `PHB` · Divination · levels: atWill/daily,L3 |
| 15 | Dispel Evil and Good | 15 | 15 | Heralds of Dust Exorcist, Omin Dran, Kostchtchie | `PHB` · Abjuration · levels: atWill/daily,L5 |
| 16 | Locate Object | 15 | 15 | Master Sage, Sage, Mephistopheles | `PHB` · Divination · levels: atWill/daily,L2 |
| 17 | Arcane Eye | 13 | 13 | Morwena Veilmist, Zythan, Lohezet | `PHB` · Divination · levels: atWill/daily,L4 |
| 18 | Identify | 13 | 13 | Master Sage, Sage, Monastic High Curator | `PHB` · Divination · levels: atWill/daily,L1 |
| 19 | Augury | 11 | 11 | Auspicia Dran, Rictavio, Anchorite of Talos | `PHB` · Divination · levels: atWill/daily,L2 |
| 20 | Locate Creature | 11 | 11 | Omin Dran, Krull, Euryale | `PHB` · Divination · levels: atWill/daily,L4 |
| 21 | Water Breathing | 11 | 11 | Alyxian the Absolved, Galsariad Ardyth (Tier 3), Amble | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 22 | Maze | 10 | 10 | Tyreus, Illusionist, Lady Illmarrow, Niv-Mizzet | `PHB` · Conjuration · levels: atWill/daily,L8 |
| 23 | Raise Dead | 10 | 10 | Arkhan the Cruel, Bel, Hollyphant | `PHB` · Necromancy · levels: atWill/daily,L5 |
| 24 | Longstrider | 9 | 9 | K'Tulah, Galsariad Ardyth (Tier 1), Galsariad Ardyth (Tier 2) | `PHB` · Transmutation · levels: atWill/daily,L1 |
| 25 | Wall of Ice | 9 | 9 | Levistus, Biomancer, Zegana | `PHB` · Evocation · levels: atWill/daily,L6 |
| 26 | Dream | 8 | 8 | Saleeth the Couatl, Cloud Giant Destiny Gambler, Dusk Hag | `PHB` · Illusion · levels: atWill/daily |
| 27 | Etherealness | 8 | 8 | Sarevok, Ancient Emerald Dragon, Mr. Dory | `PHB` · Transmutation · levels: atWill/daily |
| 28 | Wall of Stone | 8 | 8 | Hill Giant Avalancher, Stalker of Baphomet, Pech | `PHB` · Evocation · levels: atWill/daily |
| 29 | Water Walk | 8 | 8 | Pharblex Spattergoo, Verbeeg Longstrider, Empyrean | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 30 | Commune | 7 | 7 | Jenevere, Radiant Idol, Pari | `PHB` · Divination · levels: atWill/daily |
| 31 | Wish | 7 | 7 | Asmodeus, Baalzebul, Mephistopheles | `PHB` · Conjuration · levels: atWill/daily,L9 |
| 32 | Create Undead | 6 | 6 | Krull, Lady Illmarrow, Sul Khatesh | `PHB` · Necromancy · levels: atWill/daily,L6 |
| 33 | Legend Lore | 6 | 6 | Omin Dran, Master Sage, Jenevere | `PHB` · Divination · levels: atWill/daily,L5 |
| 34 | [object Object] | 5 | 8 | Zodar, Lichen Lich, Master Sage | levels: atWill/daily |
| 35 | Symbol | 5 | 6 | Baalzebul, Mephistopheles, Ygorl, Lord of Entropy | `PHB` · Abjuration · levels: atWill/daily,L7 |
| 36 | Mind Blank | 5 | 5 | Arrant Quill, Shemeshka, Acererak | `PHB` · Abjuration · levels: atWill/daily,L8 |
| 37 | Wind Walk | 5 | 5 | Kostchtchie, Pazuzu, Djinni | `PHB` · Transmutation · levels: atWill/daily |
| 38 | Antimagic Field | 4 | 4 | Asmodeus, Sarevok, Aeorian Nullifier | `PHB` · Abjuration · levels: atWill/daily,L8 |
| 39 | Awaken | 4 | 4 | Yarnspinner, Frost Druid, The Gardener | `PHB` · Transmutation · levels: atWill/daily,L5 |
| 40 | Contact Other Plane | 4 | 4 | Githyanki Star Seer, Master Sage, Shemeshka | `PHB` · Divination · levels: atWill/daily |
| 41 | Gate | 4 | 4 | Kostchtchie, Asmodeus, Sul Khatesh | `PHB` · Conjuration · levels: atWill/daily |
| 42 | Imprisonment | 4 | 4 | Bel, Isperia, Manshoon | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 43 | Magic Circle | 4 | 4 | Krull, Ezmerelda d'Avenir, Rictavio | `PHB` · Abjuration · levels: L3 |
| 44 | Conjure Elemental* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L5 |
| 45 | Evard's Black Tentacles* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L4 |
| 46 | Gentle Repose | 3 | 3 | Krull, Koh Tam, Lampad | `PHB` · Necromancy · levels: atWill/daily,L2 |
| 47 | Hallow | 3 | 3 | Baalzebul, Mephistopheles, Pazuzu | `PHB` · Evocation · levels: atWill/daily |
| 48 | Heroes' Feast | 3 | 3 | Jaheira, Androsphinx, The Gardener | `PHB` · Conjuration · levels: atWill/daily,L6 |
| 49 | Locate Animals or Plants | 3 | 3 | Barbatos, Zuggtmoy, Jarl Storvald | `PHB` · Divination · levels: atWill/daily,L2 |
| 50 | Mage Armor* | 3 | 3 | Prisoner 237, Archmage, Abjurer | levels: L1 |

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
| 12 | Wall of Force | 20 | 20 |
| 13 | Divination | 19 | 19 |
| 14 | Clairvoyance | 18 | 18 |
| 15 | Dispel Evil and Good | 15 | 15 |
| 16 | Locate Object | 15 | 15 |
| 17 | Arcane Eye | 13 | 13 |
| 18 | Identify | 13 | 13 |
| 19 | Augury | 11 | 11 |
| 20 | Locate Creature | 11 | 11 |
| 21 | Water Breathing | 11 | 11 |
| 22 | Maze | 10 | 10 |
| 23 | Raise Dead | 10 | 10 |
| 24 | Longstrider | 9 | 9 |
| 25 | Wall of Ice | 9 | 9 |
| 26 | Dream | 8 | 8 |
| 27 | Etherealness | 8 | 8 |
| 28 | Wall of Stone | 8 | 8 |
| 29 | Water Walk | 8 | 8 |
| 30 | Commune | 7 | 7 |
| 31 | Wish | 7 | 7 |
| 32 | Create Undead | 6 | 6 |
| 33 | Legend Lore | 6 | 6 |
| 34 | [object Object] | 5 | 8 |
| 35 | Symbol | 5 | 6 |
| 36 | Mind Blank | 5 | 5 |
| 37 | Wind Walk | 5 | 5 |
| 38 | Antimagic Field | 4 | 4 |
| 39 | Awaken | 4 | 4 |
| 40 | Contact Other Plane | 4 | 4 |
| 41 | Gate | 4 | 4 |
| 42 | Imprisonment | 4 | 4 |
| 43 | Magic Circle | 4 | 4 |
| 44 | Conjure Elemental* | 3 | 3 |
| 45 | Evard's Black Tentacles* | 3 | 3 |
| 46 | Gentle Repose | 3 | 3 |
| 47 | Hallow | 3 | 3 |
| 48 | Heroes' Feast | 3 | 3 |
| 49 | Locate Animals or Plants | 3 | 3 |
| 50 | Mage Armor* | 3 | 3 |
| 51 | Mirror Image* | 3 | 3 |
| 52 | Misty Step* | 3 | 3 |
| 53 | Programmed Illusion | 3 | 3 |
| 54 | Suggestion* | 3 | 3 |
| 55 | Unseen Servant* | 3 | 3 |
| 56 | Wind Wall | 3 | 3 |
| 57 | Animate Dead* | 2 | 2 |
| 58 | Arcane Lock* | 2 | 2 |
| 59 | Astral Projection | 2 | 2 |
| 60 | Blight* | 2 | 2 |
| 61 | Charm Person* | 2 | 2 |
| 62 | Cloud of Daggers* | 2 | 2 |
| 63 | Cloudkill* | 2 | 2 |
| 64 | Cone of Cold* | 2 | 2 |
| 65 | Detect Thoughts* | 2 | 2 |
| 66 | False Life* | 2 | 2 |
| 67 | Find the Path | 2 | 2 |
| 68 | Fire Bolt* | 2 | 2 |
| 69 | Hold Monster* | 2 | 2 |
| 70 | Hold Person* | 2 | 2 |
| 71 | Invisibility* | 2 | 2 |
| 72 | Light* | 2 | 2 |
| 73 | Lightning Bolt* | 2 | 2 |
| 74 | Magic Missile* | 2 | 2 |
| 75 | Major Image* | 2 | 2 |
| 76 | Phantasmal Force* | 2 | 2 |
| 77 | Phantasmal Killer* | 2 | 2 |
| 78 | Prismatic Wall | 2 | 2 |
| 79 | ray of Enfeeblement* | 2 | 2 |
| 80 | ray of Sickness* | 2 | 2 |
| 81 | Resurrection | 2 | 2 |
| 82 | Shocking Grasp* | 2 | 2 |
| 83 | Simulacrum | 2 | 2 |
| 84 | Stoneskin* | 2 | 2 |
| 85 | Vampiric Touch* | 2 | 2 |
| 86 | Wall of Thorns | 2 | 2 |
| 87 | Web* | 2 | 2 |
| 88 | Word of Recall | 2 | 2 |
| 89 | Abi-dalzim's Horrid Wilting* | 1 | 1 |
| 90 | Acid Splash * | 1 | 1 |
| 91 | Acid Splash* | 1 | 1 |
| 92 | Alarm* | 1 | 1 |
| 93 | Alter Self* | 1 | 1 |
| 94 | Arcane Eye* | 1 | 1 |
| 95 | Banishment* | 1 | 1 |
| 96 | Bestow Curse* | 1 | 1 |
| 97 | Bigby's Hand* | 1 | 1 |
| 98 | Blindness/deafness* | 1 | 1 |
| 99 | Blink* | 1 | 1 |
| 100 | Burning Hands* | 1 | 1 |
| 101 | Chain Lightning* | 1 | 1 |
| 102 | Chaos Bolt* | 1 | 1 |
| 103 | Circle of Death* | 1 | 1 |
| 104 | Clairvoyance* | 1 | 1 |
| 105 | Clone | 1 | 1 |
| 106 | Color Spray* | 1 | 1 |
| 107 | Command * | 1 | 1 |
| 108 | Confusion * | 1 | 1 |
| 109 | Contingency | 1 | 1 |
| 110 | Control Water* | 1 | 1 |
| 111 | Counterspell* | 1 | 1 |
| 112 | Demiplane | 1 | 1 |
| 113 | Detect Magic* | 1 | 1 |
| 114 | Detect Poison and Disease | 1 | 1 |
| 115 | Detect Thoughts * | 1 | 1 |
| 116 | Dimension Door* | 1 | 1 |
| 117 | Disguise Self* | 1 | 1 |
| 118 | Dispel Magic* | 1 | 1 |
| 119 | Distort Value* | 1 | 1 |
| 120 | Dominate Beast* | 1 | 1 |
| 121 | Dominate Monster * | 1 | 1 |
| 122 | Drawmij's Instant Summons | 1 | 1 |
| 123 | Enervation* | 1 | 1 |
| 124 | Expeditious Retreat* | 1 | 1 |
| 125 | Fast Friends* | 1 | 1 |
| 126 | Finger of Death* | 1 | 1 |
| 127 | Fireball* | 1 | 1 |
| 128 | Flaming Sphere* | 1 | 1 |
| 129 | Forbiddance | 1 | 1 |
| 130 | Freedom of Movement* | 1 | 1 |
| 131 | Gift of Gab* | 1 | 1 |
| 132 | Globe of Invulnerability* | 1 | 1 |
| 133 | Hallucinatory Terrain* | 1 | 1 |
| 134 | ice Storm* | 1 | 1 |
| 135 | Illusory Script | 1 | 1 |
| 136 | Incite Greed* | 1 | 1 |
| 137 | Jim's Glowing Coin* | 1 | 1 |
| 138 | Jim's Magic Missile* | 1 | 1 |
| 139 | Knock* | 1 | 1 |
| 140 | Locate Object* | 1 | 1 |
| 141 | Magic Missile * | 1 | 1 |
| 142 | Mental Prison* | 1 | 1 |
| 143 | Message* | 1 | 1 |
| 144 | Mind Blank* | 1 | 1 |
| 145 | Mislead* | 1 | 1 |
| 146 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 |
| 147 | Phantom Steed* | 1 | 1 |
| 148 | Planar Ally | 1 | 1 |
| 149 | Planar Binding | 1 | 1 |
| 150 | Polymorph* | 1 | 1 |
| 151 | Rary's Telepathic Bond* | 1 | 1 |
| 152 | ray of Frost* | 1 | 1 |
| 153 | Rope Trick | 1 | 1 |
| 154 | Scrying* | 1 | 1 |
| 155 | Sending * | 1 | 1 |
| 156 | Shapechange | 1 | 1 |
| 157 | Shatter* | 1 | 1 |
| 158 | Shield* | 1 | 1 |
| 159 | Shocking Grasp * | 1 | 1 |
| 160 | Slow* | 1 | 1 |
| 161 | Stinking Cloud* | 1 | 1 |
| 162 | Symbol* | 1 | 1 |
| 163 | Telekinesis* | 1 | 1 |
| 164 | Telepathy | 1 | 1 |
| 165 | Thunder Step* | 1 | 1 |
| 166 | Thunderclap* | 1 | 1 |
| 167 | True Seeing* | 1 | 1 |
| 168 | Wall of Ice* | 1 | 1 |
| 169 | Water Breathing* | 1 | 1 |
| 170 | Water Walk* | 1 | 1 |
| 171 | Wish* | 1 | 1 |

## Implemented Spells (already built — summary)

| Level | Implemented count |
|-------|-------------------|
| unknown | 22 |
| 0 | 33 |
| 1 | 51 |
| 2 | 55 |
| 3 | 36 |
| 4 | 30 |
| 5 | 25 |
| 6 | 12 |
| 7 | 10 |
| 8 | 6 |
| 9 | 3 |

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
