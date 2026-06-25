# Monster Spell Coverage Report

Generated: `2026-06-25T18:23:32.959Z`
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
| ├─ Already implemented | 301 (66.3%) |
| └─ NOT yet implemented | 153 (33.7%) |

## Top 50 Unbuilt Spells (by creature frequency)

Priority for future spell-module work. Each row lists the spell name, the number
of distinct creatures that know it, total references (a creature may list the same
spell at multiple slot levels — counted separately), and a few example creatures.

| Rank | Spell | # Creatures | Total Refs | Example Creatures | Notes |
|------|-------|-------------|------------|-------------------|-------|
| 1 | Detect Magic | 179 | 179 | Factol Skall, Flabbergast, Pendragon Beestinger | `PHB` · Divination · levels: atWill/daily,L1 |
| 2 | Sending | 41 | 41 | Aartuk Elder, Astral Elf Aristocrat, Astral Elf Star Priest | `PHB` · Evocation · levels: atWill/daily,L3 |
| 3 | Tongues | 36 | 36 | Exul, Morwena Veilmist, Githyanki Star Seer | `PHB` · Divination · levels: atWill/daily,L3 |
| 4 | Detect Evil and Good | 34 | 34 | Heralds of Dust Exorcist, Saleeth the Couatl, Krull | `PHB` · Divination · levels: atWill/daily,L1 |
| 5 | Protection from Evil and Good | 27 | 27 | Heralds of Dust Exorcist, Hollyphant, Skull Lasher of Myrkul | `PHB` · Abjuration · levels: atWill/daily,L1 |
| 6 | Revivify | 24 | 24 | Aartuk Starhorror, Arkhan the Cruel, Asteria | `PHB` · Necromancy · levels: atWill/daily,L3 |
| 7 | Comprehend Languages | 23 | 23 | Exul, Master Sage, Sage | `PHB` · Divination · levels: atWill/daily,L1 |
| 8 | True Seeing | 20 | 20 | Krull, Mahadi the Rakshasa, Master Sage | `PHB` · Divination · levels: atWill/daily,L6 |
| 9 | Divination | 19 | 19 | Astral Elf Star Priest, Krull, Fate Hag | `PHB` · Divination · levels: atWill/daily,L4 |
| 10 | Clairvoyance | 18 | 18 | Valin Sarnaster, Ezmerelda d'Avenir, Kalaraq Quori | `PHB` · Divination · levels: atWill/daily,L3 |
| 11 | Dispel Evil and Good | 15 | 15 | Heralds of Dust Exorcist, Omin Dran, Kostchtchie | `PHB` · Abjuration · levels: atWill/daily,L5 |
| 12 | Locate Object | 15 | 15 | Master Sage, Sage, Mephistopheles | `PHB` · Divination · levels: atWill/daily,L2 |
| 13 | Arcane Eye | 13 | 13 | Morwena Veilmist, Zythan, Lohezet | `PHB` · Divination · levels: atWill/daily,L4 |
| 14 | Identify | 13 | 13 | Master Sage, Sage, Monastic High Curator | `PHB` · Divination · levels: atWill/daily,L1 |
| 15 | Augury | 11 | 11 | Auspicia Dran, Rictavio, Anchorite of Talos | `PHB` · Divination · levels: atWill/daily,L2 |
| 16 | Locate Creature | 11 | 11 | Omin Dran, Krull, Euryale | `PHB` · Divination · levels: atWill/daily,L4 |
| 17 | Water Breathing | 11 | 11 | Alyxian the Absolved, Galsariad Ardyth (Tier 3), Amble | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 18 | Longstrider | 9 | 9 | K'Tulah, Galsariad Ardyth (Tier 1), Galsariad Ardyth (Tier 2) | `PHB` · Transmutation · levels: atWill/daily,L1 |
| 19 | Dream | 8 | 8 | Saleeth the Couatl, Cloud Giant Destiny Gambler, Dusk Hag | `PHB` · Illusion · levels: atWill/daily |
| 20 | Water Walk | 8 | 8 | Pharblex Spattergoo, Verbeeg Longstrider, Empyrean | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 21 | Commune | 7 | 7 | Jenevere, Radiant Idol, Pari | `PHB` · Divination · levels: atWill/daily |
| 22 | Legend Lore | 6 | 6 | Omin Dran, Master Sage, Jenevere | `PHB` · Divination · levels: atWill/daily,L5 |
| 23 | [object Object] | 5 | 8 | Zodar, Lichen Lich, Master Sage | levels: atWill/daily |
| 24 | Awaken | 4 | 4 | Yarnspinner, Frost Druid, The Gardener | `PHB` · Transmutation · levels: atWill/daily,L5 |
| 25 | Contact Other Plane | 4 | 4 | Githyanki Star Seer, Master Sage, Shemeshka | `PHB` · Divination · levels: atWill/daily |
| 26 | Imprisonment | 4 | 4 | Bel, Isperia, Manshoon | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 27 | Conjure Elemental* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L5 |
| 28 | Evard's Black Tentacles* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L4 |
| 29 | Gentle Repose | 3 | 3 | Krull, Koh Tam, Lampad | `PHB` · Necromancy · levels: atWill/daily,L2 |
| 30 | Heroes' Feast | 3 | 3 | Jaheira, Androsphinx, The Gardener | `PHB` · Conjuration · levels: atWill/daily,L6 |
| 31 | Locate Animals or Plants | 3 | 3 | Barbatos, Zuggtmoy, Jarl Storvald | `PHB` · Divination · levels: atWill/daily,L2 |
| 32 | Mage Armor* | 3 | 3 | Prisoner 237, Archmage, Abjurer | levels: L1 |
| 33 | Mirror Image* | 3 | 3 | Tyreus, Illusionist, Gar Shatterkeel, Illusionist | levels: L2 |
| 34 | Misty Step* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L2 |
| 35 | Programmed Illusion | 3 | 3 | Baba Lysaga, Fraz-Urb'luu, Halaster Blackcloak | `PHB` · Illusion · levels: atWill/daily,L6 |
| 36 | Suggestion* | 3 | 3 | Morwena Veilmist, Prisoner 237, Enchanter | levels: L2 |
| 37 | Unseen Servant* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L1 |
| 38 | Wind Wall | 3 | 3 | Frost Druid, Triton Master of Waves, Asharra | `PHB` · Evocation · levels: atWill/daily,L3 |
| 39 | Animate Dead* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L3 |
| 40 | Arcane Lock* | 2 | 2 | Prisoner 237, Abjurer | levels: L2 |
| 41 | Astral Projection | 2 | 2 | Sarevok, Pazuzu | `PHB` · Necromancy · levels: atWill/daily |
| 42 | Blight* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L4 |
| 43 | Charm Person* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L1 |
| 44 | Cloud of Daggers* | 2 | 2 | Malivar, Conjurer | levels: L2 |
| 45 | Cloudkill* | 2 | 2 | Tarul Var, Conjurer | levels: L5 |
| 46 | Cone of Cold* | 2 | 2 | Malivar, Evoker | levels: L5 |
| 47 | Detect Thoughts* | 2 | 2 | Prisoner 237, Diviner | levels: L2 |
| 48 | False Life* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L1 |
| 49 | Find the Path | 2 | 2 | Madam Eva, Klauth | `PHB` · Divination · levels: atWill/daily,L6 |
| 50 | Fire Bolt* | 2 | 2 | Spellix Romwod, Evoker | levels: atWill/daily,L0 |

## Full Unbuilt Spells List (all)

| Rank | Spell | # Creatures | Total Refs |
|------|-------|-------------|------------|
| 1 | Detect Magic | 179 | 179 |
| 2 | Sending | 41 | 41 |
| 3 | Tongues | 36 | 36 |
| 4 | Detect Evil and Good | 34 | 34 |
| 5 | Protection from Evil and Good | 27 | 27 |
| 6 | Revivify | 24 | 24 |
| 7 | Comprehend Languages | 23 | 23 |
| 8 | True Seeing | 20 | 20 |
| 9 | Divination | 19 | 19 |
| 10 | Clairvoyance | 18 | 18 |
| 11 | Dispel Evil and Good | 15 | 15 |
| 12 | Locate Object | 15 | 15 |
| 13 | Arcane Eye | 13 | 13 |
| 14 | Identify | 13 | 13 |
| 15 | Augury | 11 | 11 |
| 16 | Locate Creature | 11 | 11 |
| 17 | Water Breathing | 11 | 11 |
| 18 | Longstrider | 9 | 9 |
| 19 | Dream | 8 | 8 |
| 20 | Water Walk | 8 | 8 |
| 21 | Commune | 7 | 7 |
| 22 | Legend Lore | 6 | 6 |
| 23 | [object Object] | 5 | 8 |
| 24 | Awaken | 4 | 4 |
| 25 | Contact Other Plane | 4 | 4 |
| 26 | Imprisonment | 4 | 4 |
| 27 | Conjure Elemental* | 3 | 3 |
| 28 | Evard's Black Tentacles* | 3 | 3 |
| 29 | Gentle Repose | 3 | 3 |
| 30 | Heroes' Feast | 3 | 3 |
| 31 | Locate Animals or Plants | 3 | 3 |
| 32 | Mage Armor* | 3 | 3 |
| 33 | Mirror Image* | 3 | 3 |
| 34 | Misty Step* | 3 | 3 |
| 35 | Programmed Illusion | 3 | 3 |
| 36 | Suggestion* | 3 | 3 |
| 37 | Unseen Servant* | 3 | 3 |
| 38 | Wind Wall | 3 | 3 |
| 39 | Animate Dead* | 2 | 2 |
| 40 | Arcane Lock* | 2 | 2 |
| 41 | Astral Projection | 2 | 2 |
| 42 | Blight* | 2 | 2 |
| 43 | Charm Person* | 2 | 2 |
| 44 | Cloud of Daggers* | 2 | 2 |
| 45 | Cloudkill* | 2 | 2 |
| 46 | Cone of Cold* | 2 | 2 |
| 47 | Detect Thoughts* | 2 | 2 |
| 48 | False Life* | 2 | 2 |
| 49 | Find the Path | 2 | 2 |
| 50 | Fire Bolt* | 2 | 2 |
| 51 | Hold Monster* | 2 | 2 |
| 52 | Hold Person* | 2 | 2 |
| 53 | Invisibility* | 2 | 2 |
| 54 | Light* | 2 | 2 |
| 55 | Lightning Bolt* | 2 | 2 |
| 56 | Magic Missile* | 2 | 2 |
| 57 | Major Image* | 2 | 2 |
| 58 | Phantasmal Force* | 2 | 2 |
| 59 | Phantasmal Killer* | 2 | 2 |
| 60 | Prismatic Wall | 2 | 2 |
| 61 | ray of Enfeeblement* | 2 | 2 |
| 62 | ray of Sickness* | 2 | 2 |
| 63 | Resurrection | 2 | 2 |
| 64 | Shocking Grasp* | 2 | 2 |
| 65 | Simulacrum | 2 | 2 |
| 66 | Stoneskin* | 2 | 2 |
| 67 | Vampiric Touch* | 2 | 2 |
| 68 | Wall of Thorns | 2 | 2 |
| 69 | Web* | 2 | 2 |
| 70 | Word of Recall | 2 | 2 |
| 71 | Abi-dalzim's Horrid Wilting* | 1 | 1 |
| 72 | Acid Splash * | 1 | 1 |
| 73 | Acid Splash* | 1 | 1 |
| 74 | Alarm* | 1 | 1 |
| 75 | Alter Self* | 1 | 1 |
| 76 | Arcane Eye* | 1 | 1 |
| 77 | Banishment* | 1 | 1 |
| 78 | Bestow Curse* | 1 | 1 |
| 79 | Bigby's Hand* | 1 | 1 |
| 80 | Blindness/deafness* | 1 | 1 |
| 81 | Blink* | 1 | 1 |
| 82 | Burning Hands* | 1 | 1 |
| 83 | Chain Lightning* | 1 | 1 |
| 84 | Chaos Bolt* | 1 | 1 |
| 85 | Circle of Death* | 1 | 1 |
| 86 | Clairvoyance* | 1 | 1 |
| 87 | Clone | 1 | 1 |
| 88 | Color Spray* | 1 | 1 |
| 89 | Command * | 1 | 1 |
| 90 | Confusion * | 1 | 1 |
| 91 | Contingency | 1 | 1 |
| 92 | Control Water* | 1 | 1 |
| 93 | Counterspell* | 1 | 1 |
| 94 | Demiplane | 1 | 1 |
| 95 | Detect Magic* | 1 | 1 |
| 96 | Detect Poison and Disease | 1 | 1 |
| 97 | Detect Thoughts * | 1 | 1 |
| 98 | Dimension Door* | 1 | 1 |
| 99 | Disguise Self* | 1 | 1 |
| 100 | Dispel Magic* | 1 | 1 |
| 101 | Distort Value* | 1 | 1 |
| 102 | Dominate Beast* | 1 | 1 |
| 103 | Dominate Monster * | 1 | 1 |
| 104 | Drawmij's Instant Summons | 1 | 1 |
| 105 | Enervation* | 1 | 1 |
| 106 | Expeditious Retreat* | 1 | 1 |
| 107 | Fast Friends* | 1 | 1 |
| 108 | Finger of Death* | 1 | 1 |
| 109 | Fireball* | 1 | 1 |
| 110 | Flaming Sphere* | 1 | 1 |
| 111 | Forbiddance | 1 | 1 |
| 112 | Freedom of Movement* | 1 | 1 |
| 113 | Gift of Gab* | 1 | 1 |
| 114 | Globe of Invulnerability* | 1 | 1 |
| 115 | Hallucinatory Terrain* | 1 | 1 |
| 116 | ice Storm* | 1 | 1 |
| 117 | Illusory Script | 1 | 1 |
| 118 | Incite Greed* | 1 | 1 |
| 119 | Jim's Glowing Coin* | 1 | 1 |
| 120 | Jim's Magic Missile* | 1 | 1 |
| 121 | Knock* | 1 | 1 |
| 122 | Locate Object* | 1 | 1 |
| 123 | Magic Missile * | 1 | 1 |
| 124 | Mental Prison* | 1 | 1 |
| 125 | Message* | 1 | 1 |
| 126 | Mind Blank* | 1 | 1 |
| 127 | Mislead* | 1 | 1 |
| 128 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 |
| 129 | Phantom Steed* | 1 | 1 |
| 130 | Planar Ally | 1 | 1 |
| 131 | Planar Binding | 1 | 1 |
| 132 | Polymorph* | 1 | 1 |
| 133 | Rary's Telepathic Bond* | 1 | 1 |
| 134 | ray of Frost* | 1 | 1 |
| 135 | Rope Trick | 1 | 1 |
| 136 | Scrying* | 1 | 1 |
| 137 | Sending * | 1 | 1 |
| 138 | Shapechange | 1 | 1 |
| 139 | Shatter* | 1 | 1 |
| 140 | Shield* | 1 | 1 |
| 141 | Shocking Grasp * | 1 | 1 |
| 142 | Slow* | 1 | 1 |
| 143 | Stinking Cloud* | 1 | 1 |
| 144 | Symbol* | 1 | 1 |
| 145 | Telekinesis* | 1 | 1 |
| 146 | Telepathy | 1 | 1 |
| 147 | Thunder Step* | 1 | 1 |
| 148 | Thunderclap* | 1 | 1 |
| 149 | True Seeing* | 1 | 1 |
| 150 | Wall of Ice* | 1 | 1 |
| 151 | Water Breathing* | 1 | 1 |
| 152 | Water Walk* | 1 | 1 |
| 153 | Wish* | 1 | 1 |

## Implemented Spells (already built — summary)

| Level | Implemented count |
|-------|-------------------|
| unknown | 27 |
| 0 | 33 |
| 1 | 51 |
| 2 | 55 |
| 3 | 38 |
| 4 | 30 |
| 5 | 27 |
| 6 | 14 |
| 7 | 13 |
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
