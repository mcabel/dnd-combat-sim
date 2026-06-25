# Monster Spell Coverage Report

Generated: `2026-06-25T19:14:02.485Z`
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
| ├─ Already implemented | 316 (69.6%) |
| └─ NOT yet implemented | 138 (30.4%) |

## Top 50 Unbuilt Spells (by creature frequency)

Priority for future spell-module work. Each row lists the spell name, the number
of distinct creatures that know it, total references (a creature may list the same
spell at multiple slot levels — counted separately), and a few example creatures.

| Rank | Spell | # Creatures | Total Refs | Example Creatures | Notes |
|------|-------|-------------|------------|-------------------|-------|
| 1 | Protection from Evil and Good | 27 | 27 | Heralds of Dust Exorcist, Hollyphant, Skull Lasher of Myrkul | `PHB` · Abjuration · levels: atWill/daily,L1 |
| 2 | Dispel Evil and Good | 15 | 15 | Heralds of Dust Exorcist, Omin Dran, Kostchtchie | `PHB` · Abjuration · levels: atWill/daily,L5 |
| 3 | Longstrider | 9 | 9 | K'Tulah, Galsariad Ardyth (Tier 1), Galsariad Ardyth (Tier 2) | `PHB` · Transmutation · levels: atWill/daily,L1 |
| 4 | Dream | 8 | 8 | Saleeth the Couatl, Cloud Giant Destiny Gambler, Dusk Hag | `PHB` · Illusion · levels: atWill/daily |
| 5 | Water Walk | 8 | 8 | Pharblex Spattergoo, Verbeeg Longstrider, Empyrean | `PHB` · Transmutation · levels: atWill/daily,L3 |
| 6 | Commune | 7 | 7 | Jenevere, Radiant Idol, Pari | `PHB` · Divination · levels: atWill/daily |
| 7 | Legend Lore | 6 | 6 | Omin Dran, Master Sage, Jenevere | `PHB` · Divination · levels: atWill/daily,L5 |
| 8 | [object Object] | 5 | 8 | Zodar, Lichen Lich, Master Sage | levels: atWill/daily |
| 9 | Awaken | 4 | 4 | Yarnspinner, Frost Druid, The Gardener | `PHB` · Transmutation · levels: atWill/daily,L5 |
| 10 | Contact Other Plane | 4 | 4 | Githyanki Star Seer, Master Sage, Shemeshka | `PHB` · Divination · levels: atWill/daily |
| 11 | Imprisonment | 4 | 4 | Bel, Isperia, Manshoon | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 12 | Conjure Elemental* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L5 |
| 13 | Evard's Black Tentacles* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L4 |
| 14 | Gentle Repose | 3 | 3 | Krull, Koh Tam, Lampad | `PHB` · Necromancy · levels: atWill/daily,L2 |
| 15 | Heroes' Feast | 3 | 3 | Jaheira, Androsphinx, The Gardener | `PHB` · Conjuration · levels: atWill/daily,L6 |
| 16 | Locate Animals or Plants | 3 | 3 | Barbatos, Zuggtmoy, Jarl Storvald | `PHB` · Divination · levels: atWill/daily,L2 |
| 17 | Mage Armor* | 3 | 3 | Prisoner 237, Archmage, Abjurer | levels: L1 |
| 18 | Mirror Image* | 3 | 3 | Tyreus, Illusionist, Gar Shatterkeel, Illusionist | levels: L2 |
| 19 | Misty Step* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L2 |
| 20 | Programmed Illusion | 3 | 3 | Baba Lysaga, Fraz-Urb'luu, Halaster Blackcloak | `PHB` · Illusion · levels: atWill/daily,L6 |
| 21 | Suggestion* | 3 | 3 | Morwena Veilmist, Prisoner 237, Enchanter | levels: L2 |
| 22 | Unseen Servant* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L1 |
| 23 | Wind Wall | 3 | 3 | Frost Druid, Triton Master of Waves, Asharra | `PHB` · Evocation · levels: atWill/daily,L3 |
| 24 | Animate Dead* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L3 |
| 25 | Arcane Lock* | 2 | 2 | Prisoner 237, Abjurer | levels: L2 |
| 26 | Astral Projection | 2 | 2 | Sarevok, Pazuzu | `PHB` · Necromancy · levels: atWill/daily |
| 27 | Blight* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L4 |
| 28 | Charm Person* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L1 |
| 29 | Cloud of Daggers* | 2 | 2 | Malivar, Conjurer | levels: L2 |
| 30 | Cloudkill* | 2 | 2 | Tarul Var, Conjurer | levels: L5 |
| 31 | Cone of Cold* | 2 | 2 | Malivar, Evoker | levels: L5 |
| 32 | Detect Thoughts* | 2 | 2 | Prisoner 237, Diviner | levels: L2 |
| 33 | False Life* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L1 |
| 34 | Find the Path | 2 | 2 | Madam Eva, Klauth | `PHB` · Divination · levels: atWill/daily,L6 |
| 35 | Fire Bolt* | 2 | 2 | Spellix Romwod, Evoker | levels: atWill/daily,L0 |
| 36 | Hold Monster* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L5 |
| 37 | Hold Person* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L2 |
| 38 | Invisibility* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L2 |
| 39 | Light* | 2 | 2 | Prisoner 237, Evoker | levels: L0 |
| 40 | Lightning Bolt* | 2 | 2 | Prisoner 237, Evoker | levels: L3 |
| 41 | Magic Missile* | 2 | 2 | Dzaan's Simulacrum, Evoker | levels: L1 |
| 42 | Major Image* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L3 |
| 43 | Phantasmal Force* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L2 |
| 44 | Phantasmal Killer* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L4 |
| 45 | Prismatic Wall | 2 | 2 | Ekengarik, Niv-Mizzet | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 46 | ray of Enfeeblement* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L2 |
| 47 | ray of Sickness* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L1 |
| 48 | Resurrection | 2 | 2 | Mephistopheles, Solar | `PHB` · Necromancy · levels: atWill/daily |
| 49 | Shocking Grasp* | 2 | 2 | Dzaan's Simulacrum, Spellix Romwod | levels: atWill/daily,L0 |
| 50 | Simulacrum | 2 | 2 | Edwin Odesseiron, Manshoon | `PHB` · Illusion · levels: atWill/daily,L7 |

## Full Unbuilt Spells List (all)

| Rank | Spell | # Creatures | Total Refs |
|------|-------|-------------|------------|
| 1 | Protection from Evil and Good | 27 | 27 |
| 2 | Dispel Evil and Good | 15 | 15 |
| 3 | Longstrider | 9 | 9 |
| 4 | Dream | 8 | 8 |
| 5 | Water Walk | 8 | 8 |
| 6 | Commune | 7 | 7 |
| 7 | Legend Lore | 6 | 6 |
| 8 | [object Object] | 5 | 8 |
| 9 | Awaken | 4 | 4 |
| 10 | Contact Other Plane | 4 | 4 |
| 11 | Imprisonment | 4 | 4 |
| 12 | Conjure Elemental* | 3 | 3 |
| 13 | Evard's Black Tentacles* | 3 | 3 |
| 14 | Gentle Repose | 3 | 3 |
| 15 | Heroes' Feast | 3 | 3 |
| 16 | Locate Animals or Plants | 3 | 3 |
| 17 | Mage Armor* | 3 | 3 |
| 18 | Mirror Image* | 3 | 3 |
| 19 | Misty Step* | 3 | 3 |
| 20 | Programmed Illusion | 3 | 3 |
| 21 | Suggestion* | 3 | 3 |
| 22 | Unseen Servant* | 3 | 3 |
| 23 | Wind Wall | 3 | 3 |
| 24 | Animate Dead* | 2 | 2 |
| 25 | Arcane Lock* | 2 | 2 |
| 26 | Astral Projection | 2 | 2 |
| 27 | Blight* | 2 | 2 |
| 28 | Charm Person* | 2 | 2 |
| 29 | Cloud of Daggers* | 2 | 2 |
| 30 | Cloudkill* | 2 | 2 |
| 31 | Cone of Cold* | 2 | 2 |
| 32 | Detect Thoughts* | 2 | 2 |
| 33 | False Life* | 2 | 2 |
| 34 | Find the Path | 2 | 2 |
| 35 | Fire Bolt* | 2 | 2 |
| 36 | Hold Monster* | 2 | 2 |
| 37 | Hold Person* | 2 | 2 |
| 38 | Invisibility* | 2 | 2 |
| 39 | Light* | 2 | 2 |
| 40 | Lightning Bolt* | 2 | 2 |
| 41 | Magic Missile* | 2 | 2 |
| 42 | Major Image* | 2 | 2 |
| 43 | Phantasmal Force* | 2 | 2 |
| 44 | Phantasmal Killer* | 2 | 2 |
| 45 | Prismatic Wall | 2 | 2 |
| 46 | ray of Enfeeblement* | 2 | 2 |
| 47 | ray of Sickness* | 2 | 2 |
| 48 | Resurrection | 2 | 2 |
| 49 | Shocking Grasp* | 2 | 2 |
| 50 | Simulacrum | 2 | 2 |
| 51 | Stoneskin* | 2 | 2 |
| 52 | Vampiric Touch* | 2 | 2 |
| 53 | Wall of Thorns | 2 | 2 |
| 54 | Web* | 2 | 2 |
| 55 | Word of Recall | 2 | 2 |
| 56 | Abi-dalzim's Horrid Wilting* | 1 | 1 |
| 57 | Acid Splash * | 1 | 1 |
| 58 | Acid Splash* | 1 | 1 |
| 59 | Alarm* | 1 | 1 |
| 60 | Alter Self* | 1 | 1 |
| 61 | Arcane Eye* | 1 | 1 |
| 62 | Banishment* | 1 | 1 |
| 63 | Bestow Curse* | 1 | 1 |
| 64 | Bigby's Hand* | 1 | 1 |
| 65 | Blindness/deafness* | 1 | 1 |
| 66 | Blink* | 1 | 1 |
| 67 | Burning Hands* | 1 | 1 |
| 68 | Chain Lightning* | 1 | 1 |
| 69 | Chaos Bolt* | 1 | 1 |
| 70 | Circle of Death* | 1 | 1 |
| 71 | Clairvoyance* | 1 | 1 |
| 72 | Clone | 1 | 1 |
| 73 | Color Spray* | 1 | 1 |
| 74 | Command * | 1 | 1 |
| 75 | Confusion * | 1 | 1 |
| 76 | Contingency | 1 | 1 |
| 77 | Control Water* | 1 | 1 |
| 78 | Counterspell* | 1 | 1 |
| 79 | Demiplane | 1 | 1 |
| 80 | Detect Magic* | 1 | 1 |
| 81 | Detect Poison and Disease | 1 | 1 |
| 82 | Detect Thoughts * | 1 | 1 |
| 83 | Dimension Door* | 1 | 1 |
| 84 | Disguise Self* | 1 | 1 |
| 85 | Dispel Magic* | 1 | 1 |
| 86 | Distort Value* | 1 | 1 |
| 87 | Dominate Beast* | 1 | 1 |
| 88 | Dominate Monster * | 1 | 1 |
| 89 | Drawmij's Instant Summons | 1 | 1 |
| 90 | Enervation* | 1 | 1 |
| 91 | Expeditious Retreat* | 1 | 1 |
| 92 | Fast Friends* | 1 | 1 |
| 93 | Finger of Death* | 1 | 1 |
| 94 | Fireball* | 1 | 1 |
| 95 | Flaming Sphere* | 1 | 1 |
| 96 | Forbiddance | 1 | 1 |
| 97 | Freedom of Movement* | 1 | 1 |
| 98 | Gift of Gab* | 1 | 1 |
| 99 | Globe of Invulnerability* | 1 | 1 |
| 100 | Hallucinatory Terrain* | 1 | 1 |
| 101 | ice Storm* | 1 | 1 |
| 102 | Illusory Script | 1 | 1 |
| 103 | Incite Greed* | 1 | 1 |
| 104 | Jim's Glowing Coin* | 1 | 1 |
| 105 | Jim's Magic Missile* | 1 | 1 |
| 106 | Knock* | 1 | 1 |
| 107 | Locate Object* | 1 | 1 |
| 108 | Magic Missile * | 1 | 1 |
| 109 | Mental Prison* | 1 | 1 |
| 110 | Message* | 1 | 1 |
| 111 | Mind Blank* | 1 | 1 |
| 112 | Mislead* | 1 | 1 |
| 113 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 |
| 114 | Phantom Steed* | 1 | 1 |
| 115 | Planar Ally | 1 | 1 |
| 116 | Planar Binding | 1 | 1 |
| 117 | Polymorph* | 1 | 1 |
| 118 | Rary's Telepathic Bond* | 1 | 1 |
| 119 | ray of Frost* | 1 | 1 |
| 120 | Rope Trick | 1 | 1 |
| 121 | Scrying* | 1 | 1 |
| 122 | Sending * | 1 | 1 |
| 123 | Shapechange | 1 | 1 |
| 124 | Shatter* | 1 | 1 |
| 125 | Shield* | 1 | 1 |
| 126 | Shocking Grasp * | 1 | 1 |
| 127 | Slow* | 1 | 1 |
| 128 | Stinking Cloud* | 1 | 1 |
| 129 | Symbol* | 1 | 1 |
| 130 | Telekinesis* | 1 | 1 |
| 131 | Telepathy | 1 | 1 |
| 132 | Thunder Step* | 1 | 1 |
| 133 | Thunderclap* | 1 | 1 |
| 134 | True Seeing* | 1 | 1 |
| 135 | Wall of Ice* | 1 | 1 |
| 136 | Water Breathing* | 1 | 1 |
| 137 | Water Walk* | 1 | 1 |
| 138 | Wish* | 1 | 1 |

## Implemented Spells (already built — summary)

| Level | Implemented count |
|-------|-------------------|
| unknown | 27 |
| 0 | 33 |
| 1 | 55 |
| 2 | 57 |
| 3 | 43 |
| 4 | 33 |
| 5 | 27 |
| 6 | 15 |
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
