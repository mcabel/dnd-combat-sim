# Monster Spell Coverage Report

Generated: `2026-06-25T19:20:56.577Z`
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
| ├─ Already implemented | 328 (72.2%) |
| └─ NOT yet implemented | 126 (27.8%) |

## Top 50 Unbuilt Spells (by creature frequency)

Priority for future spell-module work. Each row lists the spell name, the number
of distinct creatures that know it, total references (a creature may list the same
spell at multiple slot levels — counted separately), and a few example creatures.

| Rank | Spell | # Creatures | Total Refs | Example Creatures | Notes |
|------|-------|-------------|------------|-------------------|-------|
| 1 | Protection from Evil and Good | 27 | 27 | Heralds of Dust Exorcist, Hollyphant, Skull Lasher of Myrkul | `PHB` · Abjuration · levels: atWill/daily,L1 |
| 2 | Dispel Evil and Good | 15 | 15 | Heralds of Dust Exorcist, Omin Dran, Kostchtchie | `PHB` · Abjuration · levels: atWill/daily,L5 |
| 3 | [object Object] | 5 | 8 | Zodar, Lichen Lich, Master Sage | levels: atWill/daily |
| 4 | Conjure Elemental* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L5 |
| 5 | Evard's Black Tentacles* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L4 |
| 6 | Mage Armor* | 3 | 3 | Prisoner 237, Archmage, Abjurer | levels: L1 |
| 7 | Mirror Image* | 3 | 3 | Tyreus, Illusionist, Gar Shatterkeel, Illusionist | levels: L2 |
| 8 | Misty Step* | 3 | 3 | Malivar, Gar Shatterkeel, Conjurer | levels: L2 |
| 9 | Suggestion* | 3 | 3 | Morwena Veilmist, Prisoner 237, Enchanter | levels: L2 |
| 10 | Unseen Servant* | 3 | 3 | Malivar, Tarul Var, Conjurer | levels: L1 |
| 11 | Wind Wall | 3 | 3 | Frost Druid, Triton Master of Waves, Asharra | `PHB` · Evocation · levels: atWill/daily,L3 |
| 12 | Animate Dead* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L3 |
| 13 | Arcane Lock* | 2 | 2 | Prisoner 237, Abjurer | levels: L2 |
| 14 | Astral Projection | 2 | 2 | Sarevok, Pazuzu | `PHB` · Necromancy · levels: atWill/daily |
| 15 | Blight* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L4 |
| 16 | Charm Person* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L1 |
| 17 | Cloud of Daggers* | 2 | 2 | Malivar, Conjurer | levels: L2 |
| 18 | Cloudkill* | 2 | 2 | Tarul Var, Conjurer | levels: L5 |
| 19 | Cone of Cold* | 2 | 2 | Malivar, Evoker | levels: L5 |
| 20 | Detect Thoughts* | 2 | 2 | Prisoner 237, Diviner | levels: L2 |
| 21 | False Life* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L1 |
| 22 | Find the Path | 2 | 2 | Madam Eva, Klauth | `PHB` · Divination · levels: atWill/daily,L6 |
| 23 | Fire Bolt* | 2 | 2 | Spellix Romwod, Evoker | levels: atWill/daily,L0 |
| 24 | Hold Monster* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L5 |
| 25 | Hold Person* | 2 | 2 | Morwena Veilmist, Enchanter | levels: L2 |
| 26 | Invisibility* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L2 |
| 27 | Light* | 2 | 2 | Prisoner 237, Evoker | levels: L0 |
| 28 | Lightning Bolt* | 2 | 2 | Prisoner 237, Evoker | levels: L3 |
| 29 | Magic Missile* | 2 | 2 | Dzaan's Simulacrum, Evoker | levels: L1 |
| 30 | Major Image* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L3 |
| 31 | Phantasmal Force* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L2 |
| 32 | Phantasmal Killer* | 2 | 2 | Tyreus, Illusionist, Illusionist | levels: L4 |
| 33 | Prismatic Wall | 2 | 2 | Ekengarik, Niv-Mizzet | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 34 | ray of Enfeeblement* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L2 |
| 35 | ray of Sickness* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L1 |
| 36 | Resurrection | 2 | 2 | Mephistopheles, Solar | `PHB` · Necromancy · levels: atWill/daily |
| 37 | Shocking Grasp* | 2 | 2 | Dzaan's Simulacrum, Spellix Romwod | levels: atWill/daily,L0 |
| 38 | Simulacrum | 2 | 2 | Edwin Odesseiron, Manshoon | `PHB` · Illusion · levels: atWill/daily,L7 |
| 39 | Stoneskin* | 2 | 2 | Archmage, Abjurer | levels: L4 |
| 40 | Vampiric Touch* | 2 | 2 | Xzar the Chaos Clone, Necromancer | levels: atWill/daily,L3 |
| 41 | Wall of Thorns | 2 | 2 | Conclave Dryad, Druid of the Old Ways | `PHB` · Conjuration · levels: atWill/daily,L6 |
| 42 | Web* | 2 | 2 | Malivar, Conjurer | levels: L2 |
| 43 | Word of Recall | 2 | 2 | Astral Elf Star Priest, Solar Bastion Knight | `PHB` · Conjuration · levels: atWill/daily |
| 44 | Abi-dalzim's Horrid Wilting* | 1 | 1 | Xzar the Chaos Clone | levels: atWill/daily |
| 45 | Acid Splash * | 1 | 1 | Dzaan | levels: L0 |
| 46 | Acid Splash* | 1 | 1 | Dzaan's Simulacrum | levels: L0 |
| 47 | Alarm* | 1 | 1 | Abjurer | levels: L1 |
| 48 | Alter Self* | 1 | 1 | Transmuter | levels: L2 |
| 49 | Arcane Eye* | 1 | 1 | Diviner | levels: L4 |
| 50 | Banishment* | 1 | 1 | Abjurer | levels: L4 |

## Full Unbuilt Spells List (all)

| Rank | Spell | # Creatures | Total Refs |
|------|-------|-------------|------------|
| 1 | Protection from Evil and Good | 27 | 27 |
| 2 | Dispel Evil and Good | 15 | 15 |
| 3 | [object Object] | 5 | 8 |
| 4 | Conjure Elemental* | 3 | 3 |
| 5 | Evard's Black Tentacles* | 3 | 3 |
| 6 | Mage Armor* | 3 | 3 |
| 7 | Mirror Image* | 3 | 3 |
| 8 | Misty Step* | 3 | 3 |
| 9 | Suggestion* | 3 | 3 |
| 10 | Unseen Servant* | 3 | 3 |
| 11 | Wind Wall | 3 | 3 |
| 12 | Animate Dead* | 2 | 2 |
| 13 | Arcane Lock* | 2 | 2 |
| 14 | Astral Projection | 2 | 2 |
| 15 | Blight* | 2 | 2 |
| 16 | Charm Person* | 2 | 2 |
| 17 | Cloud of Daggers* | 2 | 2 |
| 18 | Cloudkill* | 2 | 2 |
| 19 | Cone of Cold* | 2 | 2 |
| 20 | Detect Thoughts* | 2 | 2 |
| 21 | False Life* | 2 | 2 |
| 22 | Find the Path | 2 | 2 |
| 23 | Fire Bolt* | 2 | 2 |
| 24 | Hold Monster* | 2 | 2 |
| 25 | Hold Person* | 2 | 2 |
| 26 | Invisibility* | 2 | 2 |
| 27 | Light* | 2 | 2 |
| 28 | Lightning Bolt* | 2 | 2 |
| 29 | Magic Missile* | 2 | 2 |
| 30 | Major Image* | 2 | 2 |
| 31 | Phantasmal Force* | 2 | 2 |
| 32 | Phantasmal Killer* | 2 | 2 |
| 33 | Prismatic Wall | 2 | 2 |
| 34 | ray of Enfeeblement* | 2 | 2 |
| 35 | ray of Sickness* | 2 | 2 |
| 36 | Resurrection | 2 | 2 |
| 37 | Shocking Grasp* | 2 | 2 |
| 38 | Simulacrum | 2 | 2 |
| 39 | Stoneskin* | 2 | 2 |
| 40 | Vampiric Touch* | 2 | 2 |
| 41 | Wall of Thorns | 2 | 2 |
| 42 | Web* | 2 | 2 |
| 43 | Word of Recall | 2 | 2 |
| 44 | Abi-dalzim's Horrid Wilting* | 1 | 1 |
| 45 | Acid Splash * | 1 | 1 |
| 46 | Acid Splash* | 1 | 1 |
| 47 | Alarm* | 1 | 1 |
| 48 | Alter Self* | 1 | 1 |
| 49 | Arcane Eye* | 1 | 1 |
| 50 | Banishment* | 1 | 1 |
| 51 | Bestow Curse* | 1 | 1 |
| 52 | Bigby's Hand* | 1 | 1 |
| 53 | Blindness/deafness* | 1 | 1 |
| 54 | Blink* | 1 | 1 |
| 55 | Burning Hands* | 1 | 1 |
| 56 | Chain Lightning* | 1 | 1 |
| 57 | Chaos Bolt* | 1 | 1 |
| 58 | Circle of Death* | 1 | 1 |
| 59 | Clairvoyance* | 1 | 1 |
| 60 | Clone | 1 | 1 |
| 61 | Color Spray* | 1 | 1 |
| 62 | Command * | 1 | 1 |
| 63 | Confusion * | 1 | 1 |
| 64 | Contingency | 1 | 1 |
| 65 | Control Water* | 1 | 1 |
| 66 | Counterspell* | 1 | 1 |
| 67 | Demiplane | 1 | 1 |
| 68 | Detect Magic* | 1 | 1 |
| 69 | Detect Poison and Disease | 1 | 1 |
| 70 | Detect Thoughts * | 1 | 1 |
| 71 | Dimension Door* | 1 | 1 |
| 72 | Disguise Self* | 1 | 1 |
| 73 | Dispel Magic* | 1 | 1 |
| 74 | Distort Value* | 1 | 1 |
| 75 | Dominate Beast* | 1 | 1 |
| 76 | Dominate Monster * | 1 | 1 |
| 77 | Drawmij's Instant Summons | 1 | 1 |
| 78 | Enervation* | 1 | 1 |
| 79 | Expeditious Retreat* | 1 | 1 |
| 80 | Fast Friends* | 1 | 1 |
| 81 | Finger of Death* | 1 | 1 |
| 82 | Fireball* | 1 | 1 |
| 83 | Flaming Sphere* | 1 | 1 |
| 84 | Forbiddance | 1 | 1 |
| 85 | Freedom of Movement* | 1 | 1 |
| 86 | Gift of Gab* | 1 | 1 |
| 87 | Globe of Invulnerability* | 1 | 1 |
| 88 | Hallucinatory Terrain* | 1 | 1 |
| 89 | ice Storm* | 1 | 1 |
| 90 | Illusory Script | 1 | 1 |
| 91 | Incite Greed* | 1 | 1 |
| 92 | Jim's Glowing Coin* | 1 | 1 |
| 93 | Jim's Magic Missile* | 1 | 1 |
| 94 | Knock* | 1 | 1 |
| 95 | Locate Object* | 1 | 1 |
| 96 | Magic Missile * | 1 | 1 |
| 97 | Mental Prison* | 1 | 1 |
| 98 | Message* | 1 | 1 |
| 99 | Mind Blank* | 1 | 1 |
| 100 | Mislead* | 1 | 1 |
| 101 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 |
| 102 | Phantom Steed* | 1 | 1 |
| 103 | Planar Ally | 1 | 1 |
| 104 | Planar Binding | 1 | 1 |
| 105 | Polymorph* | 1 | 1 |
| 106 | Rary's Telepathic Bond* | 1 | 1 |
| 107 | ray of Frost* | 1 | 1 |
| 108 | Rope Trick | 1 | 1 |
| 109 | Scrying* | 1 | 1 |
| 110 | Sending * | 1 | 1 |
| 111 | Shapechange | 1 | 1 |
| 112 | Shatter* | 1 | 1 |
| 113 | Shield* | 1 | 1 |
| 114 | Shocking Grasp * | 1 | 1 |
| 115 | Slow* | 1 | 1 |
| 116 | Stinking Cloud* | 1 | 1 |
| 117 | Symbol* | 1 | 1 |
| 118 | Telekinesis* | 1 | 1 |
| 119 | Telepathy | 1 | 1 |
| 120 | Thunder Step* | 1 | 1 |
| 121 | Thunderclap* | 1 | 1 |
| 122 | True Seeing* | 1 | 1 |
| 123 | Wall of Ice* | 1 | 1 |
| 124 | Water Breathing* | 1 | 1 |
| 125 | Water Walk* | 1 | 1 |
| 126 | Wish* | 1 | 1 |

## Implemented Spells (already built — summary)

| Level | Implemented count |
|-------|-------------------|
| unknown | 30 |
| 0 | 33 |
| 1 | 56 |
| 2 | 59 |
| 3 | 44 |
| 4 | 33 |
| 5 | 29 |
| 6 | 17 |
| 7 | 13 |
| 8 | 9 |
| 9 | 5 |

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
