/**
 * Canonical pre-2024 D&D 5e class spell lists.
 * Source: PHB (2014), XGE (2017), TCE (2020).
 *
 * Each entry maps a class name to the spell names it can learn/prepare
 * at each spell level (0 = cantrips). Spell names match those in
 * testDataSpells/spells-*.json exactly.
 *
 * Artificer, Eldritch Knight (Fighter), and Arcane Trickster (Rogue)
 * use Wizard cantrips/spells and are aliased accordingly.
 */

export type SpellcastingClassName =
  | 'Bard' | 'Cleric' | 'Druid' | 'Paladin'
  | 'Ranger' | 'Sorcerer' | 'Warlock' | 'Wizard';

/** Map of class name → spell level (0–9) → spell names. */
export const CLASS_SPELL_LISTS: Record<SpellcastingClassName, string[][]> = {

  // ── Bard ────────────────────────────────────────────────────────────
  Bard: [
    /* 0 */ ['Dancing Lights', 'Light', 'Mage Hand', 'Mending', 'Message',
             'Minor Illusion', 'Prestidigitation', 'True Strike', 'Vicious Mockery',
             // XGE
             'Thunderclap'],
    /* 1 */ ['Animal Friendship', 'Bane', 'Charm Person', 'Color Spray', 'Command',
             'Comprehend Languages', 'Cure Wounds', 'Detect Magic', 'Disguise Self',
             'Dissonant Whispers', 'Faerie Fire', 'Feather Fall', 'Healing Word',
             'Heroism', 'Identify', 'Illusory Script', 'Longstrider', 'Silent Image',
             'Sleep', 'Speak with Animals', "Tasha's Hideous Laughter",
             'Thunderwave', 'Unseen Servant',
             // XGE
             'Earth Tremor'],
    /* 2 */ ['Animal Messenger', 'Blindness/Deafness', 'Calm Emotions',
             'Cloud of Daggers', 'Crown of Madness', 'Detect Thoughts',
             'Enhance Ability', 'Enthrall', 'Heat Metal', 'Hold Person',
             'Invisibility', 'Knock', 'Lesser Restoration', 'Locate Animals or Plants',
             'Locate Object', 'Magic Mouth', 'Mirror Image', "Nystul's Magic Aura",
             'Phantasmal Force', 'See Invisibility', 'Shatter', 'Silence',
             'Suggestion', 'Zone of Truth',
             // XGE
             'Pyrotechnics', 'Skywrite', 'Warding Wind'],
    /* 3 */ ['Bestow Curse', 'Clairvoyance', 'Dispel Magic', 'Fear', 'Feign Death',
             'Gaseous Form', 'Glyph of Warding', 'Hypnotic Pattern',
             "Leomund's Tiny Hut", 'Major Image', 'Mass Healing Word', 'Nondetection',
             'Plant Growth', 'Sending', 'Speak with Dead', 'Stinking Cloud', 'Tongues',
             // XGE
             'Catnap', 'Enemies Abound',
             // TCE
             'Intellect Fortress'],
    /* 4 */ ['Compulsion', 'Confusion', 'Dimension Door', 'Freedom of Movement',
             'Greater Invisibility', 'Hallucinatory Terrain', 'Locate Creature',
             'Phantasmal Killer', 'Polymorph',
             // XGE
             'Charm Monster'],
    /* 5 */ ['Animate Objects', 'Awaken', 'Dominate Person', 'Dream', 'Geas',
             'Greater Restoration', 'Hold Monster', 'Legend Lore', 'Mass Cure Wounds',
             'Mislead', 'Modify Memory', 'Raise Dead', "Rary's Telepathic Bond",
             'Scrying', 'Seeming', 'Teleportation Circle',
             // XGE
             'Skill Empowerment', 'Synaptic Static'],
    /* 6 */ ['Eyebite', 'Find the Path', 'Guards and Wards', 'Mass Suggestion',
             "Otto's Irresistible Dance", 'Programmed Illusion', 'True Seeing'],
    /* 7 */ ['Etherealness', 'Forcecage', 'Mirage Arcane',
             "Mordenkainen's Magnificent Mansion", "Mordenkainen's Sword",
             'Project Image', 'Regenerate', 'Resurrection', 'Symbol', 'Teleport',
             // TCE
             'Dream of the Blue Veil'],
    /* 8 */ ['Antipathy/Sympathy', 'Dominate Monster', 'Feeblemind', 'Glibness',
             'Mind Blank', 'Power Word Stun'],
    /* 9 */ ['Foresight', 'Power Word Heal', 'Power Word Kill', 'Prismatic Wall',
             'True Polymorph',
             // XGE
             'Mass Polymorph', 'Psychic Scream'],
  ],

  // ── Cleric ──────────────────────────────────────────────────────────
  Cleric: [
    /* 0 */ ['Guidance', 'Light', 'Mending', 'Resistance', 'Sacred Flame',
             'Spare the Dying', 'Thaumaturgy',
             // XGE
             'Toll the Dead', 'Word of Radiance'],
    /* 1 */ ['Bane', 'Bless', 'Command', 'Create or Destroy Water', 'Cure Wounds',
             'Detect Evil and Good', 'Detect Magic', 'Detect Poison and Disease',
             'Guiding Bolt', 'Healing Word', 'Inflict Wounds',
             'Protection from Evil and Good', 'Purify Food and Drink', 'Sanctuary',
             'Shield of Faith',
             // XGE
             'Ceremony'],
    /* 2 */ ['Aid', 'Augury', 'Blindness/Deafness', 'Calm Emotions', 'Continual Flame',
             'Enhance Ability', 'Find Traps', 'Gentle Repose', 'Hold Person',
             'Lesser Restoration', 'Locate Object', 'Prayer of Healing',
             'Protection from Poison', 'See Invisibility', 'Silence', 'Spiritual Weapon',
             'Warding Bond', 'Zone of Truth'],
    /* 3 */ ['Animate Dead', 'Beacon of Hope', 'Bestow Curse', 'Clairvoyance',
             'Create Food and Water', 'Daylight', 'Dispel Magic', 'Feign Death',
             'Glyph of Warding', 'Magic Circle', 'Mass Healing Word', 'Meld into Stone',
             'Protection from Energy', 'Remove Curse', 'Revivify', 'Sending',
             'Speak with Dead', 'Spirit Guardians', 'Tongues', 'Water Walk',
             // XGE
             'Life Transference', 'Tidal Wave', 'Wall of Water',
             // TCE
             'Spirit Shroud'],
    /* 4 */ ['Banishment', 'Control Water', 'Death Ward', 'Divination',
             'Freedom of Movement', 'Guardian of Faith', 'Locate Creature',
             'Stone Shape'],
    /* 5 */ ['Commune', 'Contagion', 'Dispel Evil and Good', 'Flame Strike', 'Geas',
             'Greater Restoration', 'Hallow', 'Hold Monster', 'Insect Plague',
             'Legend Lore', 'Mass Cure Wounds', 'Planar Binding', 'Raise Dead',
             'Scrying',
             // XGE
             'Dawn', 'Holy Weapon',
             // TCE
             'Summon Celestial'],
    /* 6 */ ['Blade Barrier', 'Create Undead', 'Find the Path', 'Forbiddance', 'Harm',
             'Heal', "Heroes' Feast", 'Planar Ally', 'True Seeing', 'Word of Recall'],
    /* 7 */ ['Conjure Celestial', 'Divine Word', 'Etherealness', 'Fire Storm',
             'Plane Shift', 'Regenerate', 'Resurrection', 'Symbol',
             // XGE
             'Temple of the Gods'],
    /* 8 */ ['Antimagic Field', 'Control Weather', 'Earthquake', 'Holy Aura'],
    /* 9 */ ['Astral Projection', 'Gate', 'Mass Heal', 'True Resurrection'],
  ],

  // ── Druid ───────────────────────────────────────────────────────────
  Druid: [
    /* 0 */ ['Druidcraft', 'Guidance', 'Mending', 'Poison Spray', 'Produce Flame',
             'Resistance', 'Shillelagh', 'Thorn Whip',
             // XGE
             'Control Flames', 'Create Bonfire', 'Frostbite', 'Gust', 'Infestation',
             'Magic Stone', 'Mold Earth', 'Primal Savagery', 'Shape Water', 'Thunderclap'],
    /* 1 */ ['Animal Friendship', 'Charm Person', 'Create or Destroy Water', 'Cure Wounds',
             'Detect Magic', 'Detect Poison and Disease', 'Entangle', 'Faerie Fire',
             'Fog Cloud', 'Goodberry', 'Healing Word', 'Jump', 'Longstrider',
             'Purify Food and Drink', 'Speak with Animals', 'Thunderwave',
             // XGE
             'Absorb Elements', 'Beast Bond', 'Earth Tremor', 'Ice Knife', 'Snare'],
    /* 2 */ ['Animal Messenger', 'Barkskin', 'Beast Sense', 'Darkvision',
             'Enhance Ability', 'Find Traps', 'Flame Blade', 'Flaming Sphere',
             'Gust of Wind', 'Heat Metal', 'Hold Person', 'Lesser Restoration',
             'Locate Animals or Plants', 'Locate Object', 'Moonbeam',
             'Pass without Trace', 'Protection from Poison', 'Spike Growth',
             // XGE
             'Dust Devil', 'Earthbind', 'Healing Spirit', 'Skywrite', 'Warding Wind',
             // TCE
             'Summon Beast'],
    /* 3 */ ['Call Lightning', 'Conjure Animals', 'Daylight', 'Dispel Magic',
             'Feign Death', 'Meld into Stone', 'Plant Growth', 'Protection from Energy',
             'Sleet Storm', 'Speak with Plants', 'Water Breathing', 'Water Walk',
             'Wind Wall',
             // XGE
             'Erupting Earth', 'Flame Arrows', 'Tidal Wave', 'Wall of Water',
             // TCE
             'Summon Fey'],
    /* 4 */ ['Blight', 'Conjure Minor Elementals', 'Conjure Woodland Beings',
             'Control Water', 'Dominate Beast', 'Freedom of Movement', 'Giant Insect',
             'Grasping Vine', 'Hallucinatory Terrain', 'Ice Storm', 'Locate Creature',
             'Polymorph', 'Stone Shape', 'Stoneskin', 'Wall of Fire',
             // XGE
             'Charm Monster', 'Elemental Bane', 'Guardian of Nature', 'Watery Sphere',
             // TCE
             'Summon Elemental'],
    /* 5 */ ['Antilife Shell', 'Awaken', 'Commune with Nature', 'Conjure Elemental',
             'Contagion', 'Geas', 'Greater Restoration', 'Insect Plague',
             'Mass Cure Wounds', 'Planar Binding', 'Reincarnate', 'Scrying',
             'Tree Stride', 'Wall of Stone',
             // XGE
             'Control Winds', 'Maelstrom', 'Transmute Rock', 'Wrath of Nature'],
    /* 6 */ ['Conjure Fey', 'Find the Path', 'Heal', "Heroes' Feast", 'Move Earth',
             'Sunbeam', 'Transport via Plants', 'True Seeing', 'Wall of Thorns',
             'Wind Walk',
             // XGE
             'Bones of the Earth', 'Druid Grove', 'Investiture of Flame',
             'Investiture of Ice', 'Investiture of Stone', 'Investiture of Wind',
             'Primordial Ward'],
    /* 7 */ ['Fire Storm', 'Mirage Arcane', 'Plane Shift', 'Regenerate',
             'Reverse Gravity',
             // XGE
             'Whirlwind'],
    /* 8 */ ['Animal Shapes', 'Antipathy/Sympathy', 'Control Weather', 'Earthquake',
             'Feeblemind', 'Sunburst', 'Tsunami'],
    /* 9 */ ['Foresight', 'Shapechange', 'Storm of Vengeance', 'True Resurrection'],
  ],

  // ── Paladin ─────────────────────────────────────────────────────────
  // No cantrips (level 0 is empty). Gains spells at class level 2.
  Paladin: [
    /* 0 */ [],
    /* 1 */ ['Bless', 'Command', 'Compelled Duel', 'Cure Wounds', 'Detect Evil and Good',
             'Detect Magic', 'Detect Poison and Disease', 'Divine Favor', 'Heroism',
             'Protection from Evil and Good', 'Purify Food and Drink', 'Sanctuary',
             'Searing Smite', 'Shield of Faith', 'Thunderous Smite', 'Wrathful Smite',
             // XGE
             'Ceremony'],
    /* 2 */ ['Aid', 'Branding Smite', 'Find Steed', 'Lesser Restoration', 'Locate Object',
             'Magic Weapon', 'Prayer of Healing', 'Protection from Poison', 'Warding Bond',
             'Zone of Truth'],
    /* 3 */ ['Aura of Vitality', 'Blinding Smite', 'Create Food and Water',
             "Crusader's Mantle", 'Daylight', 'Dispel Magic', 'Elemental Weapon',
             'Magic Circle', 'Remove Curse', 'Revivify',
             // TCE
             'Spirit Shroud'],
    /* 4 */ ['Aura of Life', 'Aura of Purity', 'Banishment', 'Death Ward',
             'Locate Creature', 'Staggering Smite',
             // XGE
             'Find Greater Steed'],
    /* 5 */ ['Banishing Smite', 'Circle of Power', 'Destructive Wave',
             'Dispel Evil and Good', 'Geas', 'Raise Dead',
             // XGE
             'Holy Weapon',
             // TCE
             'Summon Celestial'],
    /* 6 */ [],
    /* 7 */ [],
    /* 8 */ [],
    /* 9 */ [],
  ],

  // ── Ranger ──────────────────────────────────────────────────────────
  // No cantrips (level 0 is empty). Gains spells at class level 2.
  Ranger: [
    /* 0 */ [],
    /* 1 */ ['Alarm', 'Animal Friendship', 'Cure Wounds', 'Detect Magic',
             'Detect Poison and Disease', 'Ensnaring Strike', 'Fog Cloud', 'Goodberry',
             'Hail of Thorns', "Hunter's Mark", 'Jump', 'Longstrider',
             'Speak with Animals',
             // XGE
             'Absorb Elements', 'Beast Bond', 'Snare', 'Zephyr Strike'],
    /* 2 */ ['Animal Messenger', 'Barkskin', 'Beast Sense', 'Cordon of Arrows',
             'Darkvision', 'Find Traps', 'Lesser Restoration', 'Locate Animals or Plants',
             'Locate Object', 'Pass without Trace', 'Protection from Poison', 'Silence',
             'Spike Growth',
             // XGE
             'Healing Spirit',
             // TCE
             'Summon Beast'],
    /* 3 */ ['Conjure Animals', 'Conjure Barrage', 'Daylight', 'Lightning Arrow',
             'Nondetection', 'Plant Growth', 'Protection from Energy', 'Speak with Plants',
             'Water Breathing', 'Water Walk', 'Wind Wall',
             // XGE
             'Flame Arrows',
             // TCE
             'Summon Fey'],
    /* 4 */ ['Conjure Woodland Beings', 'Freedom of Movement', 'Grasping Vine',
             'Locate Creature', 'Stoneskin',
             // XGE
             'Guardian of Nature',
             // TCE
             'Summon Elemental'],
    /* 5 */ ['Commune with Nature', 'Conjure Volley', 'Swift Quiver', 'Tree Stride',
             // XGE
             'Steel Wind Strike', 'Wrath of Nature'],
    /* 6 */ [],
    /* 7 */ [],
    /* 8 */ [],
    /* 9 */ [],
  ],

  // ── Sorcerer ────────────────────────────────────────────────────────
  Sorcerer: [
    /* 0 */ ['Acid Splash', 'Blade Ward', 'Chill Touch', 'Dancing Lights', 'Fire Bolt',
             'Friends', 'Light', 'Mage Hand', 'Mending', 'Message', 'Minor Illusion',
             'Poison Spray', 'Prestidigitation', 'Ray of Frost', 'Shocking Grasp',
             'True Strike',
             // XGE
             'Control Flames', 'Create Bonfire', 'Frostbite', 'Gust', 'Infestation',
             'Mold Earth', 'Shape Water', 'Thunderclap',
             // TCE
             'Booming Blade', 'Green-Flame Blade', 'Lightning Lure', 'Mind Sliver',
             'Sword Burst'],
    /* 1 */ ['Burning Hands', 'Charm Person', 'Chromatic Orb', 'Color Spray',
             'Comprehend Languages', 'Detect Magic', 'Disguise Self',
             'Expeditious Retreat', 'False Life', 'Feather Fall', 'Fog Cloud', 'Jump',
             'Mage Armor', 'Magic Missile', 'Ray of Sickness', 'Shield', 'Silent Image',
             'Sleep', 'Thunderwave', 'Witch Bolt',
             // XGE
             'Absorb Elements', 'Catapult', 'Chaos Bolt', 'Earth Tremor', 'Ice Knife',
             // TCE
             "Tasha's Caustic Brew"],
    /* 2 */ ['Alter Self', 'Blindness/Deafness', 'Blur', 'Cloud of Daggers',
             'Crown of Madness', 'Darkness', 'Darkvision', 'Detect Thoughts',
             'Enhance Ability', 'Enlarge/Reduce', 'Gust of Wind', 'Hold Person',
             'Invisibility', 'Knock', 'Levitate', 'Mirror Image', 'Misty Step',
             'Phantasmal Force', 'Scorching Ray', 'See Invisibility', 'Shatter',
             'Spider Climb', 'Suggestion', 'Web',
             // XGE
             "Aganazzar's Scorcher", "Dragon's Breath", 'Dust Devil', 'Earthbind',
             "Maximilian's Earthen Grasp", 'Mind Spike', 'Pyrotechnics', 'Shadow Blade',
             "Snilloc's Snowball Swarm", 'Warding Wind',
             // TCE
             "Tasha's Mind Whip"],
    /* 3 */ ['Blink', 'Clairvoyance', 'Counterspell', 'Daylight', 'Dispel Magic',
             'Fear', 'Fireball', 'Fly', 'Gaseous Form', 'Haste', 'Hypnotic Pattern',
             'Lightning Bolt', 'Major Image', 'Protection from Energy', 'Sleet Storm',
             'Slow', 'Stinking Cloud', 'Tongues', 'Water Breathing', 'Water Walk',
             // XGE
             'Catnap', 'Enemies Abound', 'Erupting Earth', "Melf's Minute Meteors",
             'Thunder Step',
             // TCE
             'Intellect Fortress'],
    /* 4 */ ['Banishment', 'Blight', 'Confusion', 'Dimension Door', 'Dominate Beast',
             'Greater Invisibility', 'Ice Storm', 'Polymorph', 'Stoneskin',
             'Wall of Fire',
             // XGE
             'Charm Monster', 'Sickening Radiance', 'Storm Sphere', 'Vitriolic Sphere',
             'Watery Sphere'],
    /* 5 */ ['Animate Objects', 'Cloudkill', 'Cone of Cold', 'Creation',
             'Dominate Person', 'Hold Monster', 'Insect Plague', 'Seeming',
             'Telekinesis', 'Teleportation Circle', 'Wall of Stone',
             // XGE
             'Control Winds', 'Enervation', 'Far Step', 'Immolation',
             'Skill Empowerment', 'Synaptic Static', 'Wall of Light'],
    /* 6 */ ['Arcane Gate', 'Chain Lightning', 'Circle of Death', 'Disintegrate',
             'Eyebite', 'Globe of Invulnerability', 'Mass Suggestion', 'Move Earth',
             "Otiluke's Freezing Sphere", 'True Seeing',
             // XGE
             'Investiture of Flame', 'Investiture of Ice', 'Investiture of Stone',
             'Investiture of Wind', 'Mental Prison', 'Scatter',
             // TCE
             "Tasha's Otherworldly Guise"],
    /* 7 */ ['Delayed Blast Fireball', 'Etherealness', 'Finger of Death', 'Fire Storm',
             'Plane Shift', 'Prismatic Spray', 'Reverse Gravity', 'Teleport',
             // XGE
             'Crown of Stars', 'Power Word Pain', 'Whirlwind',
             // TCE
             'Dream of the Blue Veil'],
    /* 8 */ ['Dominate Monster', 'Earthquake', 'Incendiary Cloud', 'Power Word Stun',
             'Sunburst',
             // XGE
             "Abi-Dalzim's Horrid Wilting"],
    /* 9 */ ['Gate', 'Meteor Swarm', 'Power Word Kill', 'Time Stop', 'Wish',
             // XGE
             'Mass Polymorph', 'Psychic Scream',
             // TCE
             'Blade of Disaster'],
  ],

  // ── Warlock ─────────────────────────────────────────────────────────
  Warlock: [
    /* 0 */ ['Blade Ward', 'Chill Touch', 'Eldritch Blast', 'Friends', 'Mage Hand',
             'Minor Illusion', 'Poison Spray', 'Prestidigitation', 'True Strike',
             // XGE
             'Create Bonfire', 'Frostbite', 'Infestation', 'Magic Stone', 'Thunderclap',
             'Toll the Dead',
             // TCE
             'Booming Blade', 'Green-Flame Blade', 'Lightning Lure', 'Sword Burst'],
    /* 1 */ ['Armor of Agathys', 'Arms of Hadar', 'Charm Person', 'Comprehend Languages',
             'Expeditious Retreat', 'Hellish Rebuke', 'Hex', 'Illusory Script',
             'Protection from Evil and Good', 'Unseen Servant', 'Witch Bolt',
             // XGE
             'Cause Fear'],
    /* 2 */ ['Cloud of Daggers', 'Crown of Madness', 'Darkness', 'Enthrall',
             'Hold Person', 'Invisibility', 'Mirror Image', 'Misty Step',
             'Ray of Enfeeblement', 'Shatter', 'Spider Climb', 'Suggestion',
             // XGE
             'Earthbind', 'Mind Spike', 'Shadow Blade'],
    /* 3 */ ['Counterspell', 'Dispel Magic', 'Fear', 'Fly', 'Gaseous Form',
             'Hunger of Hadar', 'Hypnotic Pattern', 'Magic Circle', 'Major Image',
             'Remove Curse', 'Tongues', 'Vampiric Touch',
             // XGE
             'Enemies Abound', 'Summon Lesser Demons', 'Thunder Step',
             // TCE
             'Intellect Fortress', 'Spirit Shroud', 'Summon Fey', 'Summon Shadowspawn',
             'Summon Undead'],
    /* 4 */ ['Banishment', 'Blight', 'Dimension Door', 'Hallucinatory Terrain',
             // XGE
             'Elemental Bane', 'Shadow of Moil', 'Sickening Radiance',
             'Summon Greater Demon',
             // TCE
             'Summon Aberration'],
    /* 5 */ ['Contact Other Plane', 'Dream', 'Hold Monster', 'Scrying',
             // XGE
             'Danse Macabre', 'Enervation', 'Far Step', 'Infernal Calling',
             'Negative Energy Flood', 'Synaptic Static', 'Wall of Light'],
    /* 6 */ ['Arcane Gate', 'Circle of Death', 'Conjure Fey', 'Create Undead', 'Eyebite',
             'Flesh to Stone', 'Mass Suggestion', 'True Seeing',
             // XGE
             'Investiture of Flame', 'Investiture of Ice', 'Investiture of Stone',
             'Investiture of Wind', 'Mental Prison', 'Scatter', 'Soul Cage',
             // TCE
             'Summon Fiend', "Tasha's Otherworldly Guise"],
    /* 7 */ ['Etherealness', 'Finger of Death', 'Forcecage', 'Plane Shift',
             // XGE
             'Crown of Stars', 'Power Word Pain',
             // TCE
             'Dream of the Blue Veil'],
    /* 8 */ ['Demiplane', 'Dominate Monster', 'Feeblemind', 'Glibness',
             'Power Word Stun',
             // XGE
             'Maddening Darkness'],
    /* 9 */ ['Astral Projection', 'Foresight', 'Imprisonment', 'Power Word Kill',
             'True Polymorph', 'Weird',
             // XGE
             'Psychic Scream',
             // TCE
             'Blade of Disaster'],
  ],

  // ── Wizard ──────────────────────────────────────────────────────────
  Wizard: [
    /* 0 */ ['Acid Splash', 'Blade Ward', 'Chill Touch', 'Dancing Lights', 'Fire Bolt',
             'Friends', 'Light', 'Mage Hand', 'Mending', 'Message', 'Minor Illusion',
             'Prestidigitation', 'Ray of Frost', 'Shocking Grasp', 'True Strike',
             // XGE
             'Control Flames', 'Create Bonfire', 'Frostbite', 'Gust', 'Infestation',
             'Mold Earth', 'Shape Water', 'Thunderclap', 'Toll the Dead',
             // TCE
             'Booming Blade', 'Green-Flame Blade', 'Lightning Lure', 'Mind Sliver',
             'Sword Burst'],
    /* 1 */ ['Alarm', 'Burning Hands', 'Charm Person', 'Chromatic Orb', 'Color Spray',
             'Comprehend Languages', 'Detect Magic', 'Disguise Self',
             'Expeditious Retreat', 'False Life', 'Feather Fall', 'Find Familiar',
             'Fog Cloud', 'Grease', 'Identify', 'Illusory Script', 'Jump', 'Longstrider',
             'Mage Armor', 'Magic Missile', 'Protection from Evil and Good',
             'Ray of Sickness', 'Shield', 'Silent Image', 'Sleep',
             "Tasha's Hideous Laughter", "Tenser's Floating Disk", 'Thunderwave',
             'Unseen Servant', 'Witch Bolt',
             // XGE
             'Absorb Elements', 'Catapult', 'Cause Fear', 'Earth Tremor', 'Ice Knife',
             'Snare',
             // TCE
             "Tasha's Caustic Brew"],
    /* 2 */ ['Alter Self', 'Arcane Lock', 'Blindness/Deafness', 'Blur',
             'Cloud of Daggers', 'Continual Flame', 'Crown of Madness', 'Darkness',
             'Darkvision', 'Detect Thoughts', 'Enlarge/Reduce', 'Flaming Sphere',
             'Gentle Repose', 'Gust of Wind', 'Hold Person', 'Invisibility', 'Knock',
             'Levitate', 'Locate Object', 'Magic Mouth', 'Magic Weapon',
             "Melf's Acid Arrow", 'Mirror Image', 'Misty Step', "Nystul's Magic Aura",
             'Phantasmal Force', 'Ray of Enfeeblement', 'Rope Trick', 'Scorching Ray',
             'See Invisibility', 'Shatter', 'Spider Climb', 'Suggestion', 'Web',
             // XGE
             "Aganazzar's Scorcher", "Dragon's Breath", 'Dust Devil', 'Earthbind',
             "Maximilian's Earthen Grasp", 'Mind Spike', 'Pyrotechnics', 'Shadow Blade',
             'Skywrite', "Snilloc's Snowball Swarm", 'Warding Wind',
             // TCE
             "Tasha's Mind Whip"],
    /* 3 */ ['Animate Dead', 'Bestow Curse', 'Blink', 'Clairvoyance', 'Counterspell',
             'Dispel Magic', 'Fear', 'Feign Death', 'Fireball', 'Fly', 'Gaseous Form',
             'Glyph of Warding', 'Haste', 'Hypnotic Pattern', "Leomund's Tiny Hut",
             'Lightning Bolt', 'Magic Circle', 'Major Image', 'Nondetection',
             'Phantom Steed', 'Protection from Energy', 'Remove Curse', 'Sending',
             'Sleet Storm', 'Slow', 'Stinking Cloud', 'Tongues', 'Vampiric Touch',
             'Water Breathing',
             // XGE
             'Catnap', 'Enemies Abound', 'Erupting Earth', 'Flame Arrows',
             'Life Transference', "Melf's Minute Meteors", 'Summon Lesser Demons',
             'Thunder Step', 'Tidal Wave', 'Tiny Servant', 'Wall of Sand', 'Wall of Water',
             // TCE
             'Intellect Fortress', 'Spirit Shroud', 'Summon Fey', 'Summon Shadowspawn',
             'Summon Undead'],
    /* 4 */ ['Arcane Eye', 'Banishment', 'Blight', 'Confusion',
             'Conjure Minor Elementals', 'Dimension Door', "Evard's Black Tentacles",
             'Fabricate', 'Fire Shield', 'Greater Invisibility', 'Hallucinatory Terrain',
             'Ice Storm', "Leomund's Secret Chest", 'Locate Creature',
             "Mordenkainen's Faithful Hound", "Mordenkainen's Private Sanctum",
             "Otiluke's Resilient Sphere", 'Phantasmal Killer', 'Polymorph',
             'Stone Shape', 'Stoneskin', 'Wall of Fire',
             // XGE
             'Charm Monster', 'Elemental Bane', 'Sickening Radiance', 'Storm Sphere',
             'Summon Greater Demon', 'Vitriolic Sphere', 'Watery Sphere',
             // TCE
             'Summon Aberration', 'Summon Construct', 'Summon Elemental'],
    /* 5 */ ['Animate Objects', "Bigby's Hand", 'Cloudkill', 'Cone of Cold',
             'Conjure Elemental', 'Contact Other Plane', 'Creation', 'Dominate Person',
             'Dream', 'Geas', 'Hold Monster', 'Legend Lore', 'Mislead',
             'Modify Memory', 'Passwall', 'Planar Binding', "Rary's Telepathic Bond",
             'Scrying', 'Seeming', 'Telekinesis', 'Teleportation Circle', 'Wall of Force',
             'Wall of Stone',
             // XGE
             'Control Winds', 'Danse Macabre', 'Dawn', 'Enervation', 'Far Step',
             'Immolation', 'Infernal Calling', 'Negative Energy Flood',
             'Skill Empowerment', 'Steel Wind Strike', 'Synaptic Static',
             'Transmute Rock', 'Wall of Light'],
    /* 6 */ ['Arcane Gate', 'Chain Lightning', 'Circle of Death', 'Contingency',
             'Create Undead', 'Disintegrate', "Drawmij's Instant Summons", 'Eyebite',
             'Flesh to Stone', 'Globe of Invulnerability', 'Guards and Wards',
             'Magic Jar', 'Mass Suggestion', 'Move Earth', "Otiluke's Freezing Sphere",
             "Otto's Irresistible Dance", 'Programmed Illusion', 'Sunbeam',
             'True Seeing', 'Wall of Ice',
             // XGE
             'Create Homunculus', 'Investiture of Flame', 'Investiture of Ice',
             'Investiture of Stone', 'Investiture of Wind', 'Mental Prison', 'Scatter',
             'Soul Cage', "Tenser's Transformation",
             // TCE
             'Summon Fiend', "Tasha's Otherworldly Guise"],
    /* 7 */ ['Delayed Blast Fireball', 'Etherealness', 'Finger of Death', 'Forcecage',
             'Mirage Arcane', "Mordenkainen's Magnificent Mansion",
             "Mordenkainen's Sword", 'Plane Shift', 'Prismatic Spray', 'Project Image',
             'Reverse Gravity', 'Sequester', 'Simulacrum', 'Symbol', 'Teleport',
             // XGE
             'Crown of Stars', 'Power Word Pain', 'Whirlwind',
             // TCE
             'Dream of the Blue Veil'],
    /* 8 */ ['Antimagic Field', 'Antipathy/Sympathy', 'Clone', 'Demiplane',
             'Dominate Monster', 'Feeblemind', 'Incendiary Cloud', 'Maze', 'Mind Blank',
             'Power Word Stun', 'Sunburst', 'Telepathy',
             // XGE
             "Abi-Dalzim's Horrid Wilting", 'Illusory Dragon', 'Maddening Darkness',
             'Mighty Fortress'],
    /* 9 */ ['Astral Projection', 'Foresight', 'Gate', 'Imprisonment', 'Meteor Swarm',
             'Power Word Kill', 'Prismatic Wall', 'Shapechange', 'Time Stop',
             'True Polymorph', 'Weird', 'Wish',
             // XGE
             'Invulnerability', 'Mass Polymorph', 'Psychic Scream',
             // TCE
             'Blade of Disaster'],
  ],
};

/** Classes that alias to another class's spell list for lookup purposes. */
export const CLASS_SPELL_LIST_ALIASES: Record<string, SpellcastingClassName> = {
  'Eldritch Knight': 'Wizard',
  'Arcane Trickster': 'Wizard',
};

/** Spellcasting class names as a string array for validation. */
export const SPELLCASTING_CLASS_NAMES: string[] = Object.keys(CLASS_SPELL_LISTS);
