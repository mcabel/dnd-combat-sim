// ============================================================
// Encounter Presets
// Named encounter configurations ready to simulate.
// All use monsters from bestiaryData/ + level-1 PCs.
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import { Combatant }                           from '../types/core';
import { loadBestiaryDir }                     from '../data/loader';
import { spawnMonster }                        from '../parser/fivetools';
import { loadPCStatBlocks, spawnPC, RawPCEntry } from '../parser/pc';
import { EncounterSpec }                       from './encounter';

// ---- Data loader (lazy singleton) ---------------------------

let _bestiary: ReturnType<typeof loadBestiaryDir> | null = null;
let _pcMap: Map<string, RawPCEntry> | null = null;

function getBestiary() {
  if (!_bestiary) {
    const dir = path.join(__dirname, '../../bestiaryData');
    _bestiary = loadBestiaryDir(dir);
  }
  return _bestiary;
}

function getPCMap() {
  if (!_pcMap) {
    const candidates = [
      path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
      '/mnt/project/pc_stat_blocks_lv1.json',
    ];
    const p = candidates.find(c => fs.existsSync(c));
    if (!p) throw new Error('pc_stat_blocks_lv1.json not found');
    _pcMap = loadPCStatBlocks(JSON.parse(fs.readFileSync(p, 'utf-8')));
  }
  return _pcMap;
}

// ---- Spawn helpers ------------------------------------------

function pc(cls: string, x: number, y = 0): Combatant {
  const c = spawnPC(getPCMap(), cls, { x, y, z: 0 }, 'smart');
  if (!c) throw new Error(`PC class not found: ${cls}`);
  return c;
}

function monster(name: string, x: number, y: number, profile: Combatant['aiProfile'] = 'attackNearest'): Combatant {
  const c = spawnMonster(getBestiary().bestiary, name, { x, y, z: 0 }, profile);
  if (!c) throw new Error(`Monster not found: ${name} — is it in bestiaryData/?`);
  return c;
}

// ---- Preset registry ----------------------------------------

export interface Preset {
  id:          string;
  name:        string;
  description: string;
  build:       () => EncounterSpec;
}

/**
 * All registered presets. Each build() returns a fresh EncounterSpec.
 * Add new presets here as more bestiary files are added.
 */
export const PRESETS: Preset[] = [

  // ---- Available with bestiary-dmg.json only ----

  {
    id: 'fighter-vs-larva',
    name: 'Fighter vs Larva (1v1)',
    description: 'Level-1 Fighter (Mountain Dwarf) vs a single Larva. ' +
                 'Fighter should win consistently. Baseline sanity check.',
    build: () => ({
      party:   [ pc('Fighter', 0) ],
      enemies: [ monster('Larva', 1, 10) ],
    }),
  },

  {
    id: 'party4-vs-3larva',
    name: 'Party of 4 vs 3 Larva',
    description: 'Fighter + Barbarian + Cleric + Rogue vs three Larva. ' +
                 'Party should dominate — demonstrates multi-combatant coordination.',
    build: () => ({
      party: [
        pc('Fighter',   0),
        pc('Barbarian', 2),
        pc('Cleric',    4),
        pc('Rogue',     6),
      ],
      enemies: [
        monster('Larva', 1, 10),
        monster('Larva', 3, 10),
        monster('Larva', 5, 10),
      ],
    }),
  },

  {
    id: 'ranger-vs-larva-ranged',
    name: 'Ranger vs Larva (ranged test)',
    description: 'Ranger at distance 8 squares vs Larva. ' +
                 'Validates ranged positioning and longbow usage.',
    build: () => ({
      party:   [ pc('Ranger', 0) ],
      enemies: [ monster('Larva', 8, 10) ],
    }),
  },

  {
    id: 'wizard-vs-larva',
    name: 'Wizard vs Larva',
    description: 'Level-1 Wizard (7 HP) vs Larva. Tight fight — ' +
                 'Wizard fragility vs Larva low damage (avg 1/hit).',
    build: () => ({
      party:   [ pc('Wizard', 0) ],
      enemies: [ monster('Larva', 1, 10) ],
    }),
  },

  {
    id: 'all12-vs-larva',
    name: 'All 12 Classes vs 6 Larva',
    description: 'Full party of all 12 level-1 classes vs 6 Larva. ' +
                 'Stress test for multi-combatant engine.',
    build: () => ({
      party: [
        pc('Barbarian', 0), pc('Bard',    2),  pc('Cleric',   4),
        pc('Druid',     6), pc('Fighter', 8),  pc('Monk',     10),
        pc('Paladin',  12), pc('Ranger',  14), pc('Rogue',    16),
        pc('Sorcerer', 18), pc('Warlock', 20), pc('Wizard',   22),
      ],
      enemies: [
        monster('Larva', 2,  10),
        monster('Larva', 6,  10),
        monster('Larva', 10, 10),
        monster('Larva', 14, 10),
        monster('Larva', 18, 10),
        monster('Larva', 22, 10),
      ],
      mapWidth: 26,
    }),
  },

  // ---- Mounted combat: Wizard on Giant Fly vs 3 Larva ----
  {
    id: 'wizard-on-fly-vs-larva',
    name: 'Wizard on Giant Fly vs Larva',
    description: 'Level-1 Wizard with Giant Fly ally (Figurine of Wondrous Power) ' +
                 'vs a Larva. Fly uses defend profile until commanded. ' +
                 'NOTE: Full mount mechanics require calling setupMount() after buildEncounter().',
    build: () => {
      // Giant Fly from bestiary — loads via full bestiary map including summon-types
      const { loadBestiaryJson, monsterToCombatant } = require('../parser/fivetools');
      const fs   = require('fs');
      const path = require('path');

      const bPath = [
        path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
        path.join(__dirname, '../../bestiary-dmg.json'),
        '/mnt/project/bestiary-dmg.json',
      ].find((p: string) => fs.existsSync(p));

      if (!bPath) throw new Error('bestiary-dmg.json not found');
      const fullMap = loadBestiaryJson(JSON.parse(fs.readFileSync(bPath, 'utf-8')));
      const flyRaw  = fullMap.get('giant fly');
      if (!flyRaw) throw new Error('Giant Fly not in bestiary map');

      const wizard = pc('Wizard', 0);
      const fly    = monsterToCombatant(flyRaw, { x: 0, y: 0, z: 0 }, 'defend', 'enemy', 19);
      fly.faction  = 'party';  // ally

      return {
        party:   [ wizard, fly ],
        enemies: [ monster('Larva', 1, 10) ],
      };
    },
  },

  // ---- Multi-encounter preset is handled in multiencounter.ts ----


  // ---- Presets using only available bestiary (Larva) ----

  {
    id: 'mirror-fighter',
    name: 'Fighter vs Fighter (mirror match)',
    description: 'Two identical level-1 Fighters face off. ' +
                 'Pure RNG — expect ~50/50 win rate. Validates symmetric encounter balance.',
    build: () => {
      const a = pc('Fighter', 0); a.faction = 'enemy';
      const b = pc('Fighter', 0, 10); b.faction = 'party';
      return { party: [b], enemies: [a] };
    },
  },

  {
    id: 'survival-gauntlet-1',
    name: 'Fighter Survival Gauntlet (1 Larva)',
    description: 'Fighter vs 1 Larva. Baseline gauntlet round — should be trivial.',
    build: () => ({
      party:   [ pc('Fighter', 0) ],
      enemies: [ monster('Larva', 1, 10) ],
    }),
  },

  {
    id: 'survival-gauntlet-3',
    name: 'Fighter Survival Gauntlet (3 Larva)',
    description: 'Fighter vs 3 Larva simultaneously. ' +
                 'Action economy test: can one PC handle 3 enemies?',
    build: () => ({
      party:   [ pc('Fighter', 0) ],
      enemies: [
        monster('Larva', 1, 10),
        monster('Larva', 3, 10),
        monster('Larva', 5, 10),
      ],
    }),
  },

  {
    id: 'survival-gauntlet-6',
    name: 'Fighter Survival Gauntlet (6 Larva)',
    description: 'Fighter vs 6 Larva — extreme action economy disadvantage. ' +
                 'Expected to lose. Tests engine stability under asymmetric load.',
    build: () => ({
      party:   [ pc('Fighter', 0) ],
      enemies: [
        monster('Larva', 1, 10), monster('Larva', 3, 10),
        monster('Larva', 5, 10), monster('Larva', 7, 10),
        monster('Larva', 9, 10), monster('Larva', 11, 10),
      ],
      mapWidth: 15,
    }),
  },

  {
    id: 'caster-vs-larva',
    name: 'Sorcerer vs Larva (caster fragility)',
    description: 'Level-1 Sorcerer (7 HP) vs a Larva. ' +
                 'Tests caster fragility — Larva avg 1 dmg/hit, but Sorcerer has Sleep.',
    build: () => ({
      party:   [ pc('Sorcerer', 0) ],
      enemies: [ monster('Larva', 1, 10) ],
    }),
  },

  {
    id: 'healer-vs-larva',
    name: 'Cleric vs 2 Larva (healer sustain)',
    description: 'Life Cleric vs 2 Larva. Tests healing sustain — ' +
                 'can the Cleric out-heal Larva damage while also fighting?',
    build: () => ({
      party:   [ pc('Cleric', 0) ],
      enemies: [
        monster('Larva', 1, 10),
        monster('Larva', 3, 10),
      ],
    }),
  },

  // ---- Presets using MM bestiary (available after bestiary-mm-2014.json added) ----

  {
    id: 'party4-vs-goblin-band',
    name: 'Party of 4 vs 4 Goblins',
    description: 'Classic CR 1/4 encounter. Goblins have Nimble Escape. ' +
                 'Good action economy test — each Goblin can disengage as bonus action.',
    build: () => ({
      party:   [ pc('Fighter',0), pc('Rogue',2), pc('Cleric',4), pc('Wizard',6) ],
      enemies: [
        monster('Goblin',1,10,'smart'), monster('Goblin',3,10,'smart'),
        monster('Goblin',5,10,'smart'), monster('Goblin',7,10,'smart'),
      ],
    }),
  },

  {
    id: 'party4-vs-wolf-pack',
    name: 'Party of 4 vs Wolf Pack',
    description: 'Wolves have Pack Tactics (advantage when ally adjacent to target). ' +
                 'Classic CR 1/4 encounter testing the Pack Tactics mechanic.',
    build: () => ({
      party:   [ pc('Fighter',0), pc('Barbarian',2), pc('Druid',4), pc('Ranger',6) ],
      enemies: [
        monster('Wolf',1,10,'attackNearest'), monster('Wolf',3,10,'attackNearest'),
        monster('Wolf',5,10,'attackNearest'), monster('Wolf',7,10,'attackNearest'),
      ],
    }),
  },

  {
    id: 'party4-vs-skeletons',
    name: 'Party of 4 vs 4 Skeletons',
    description: 'Undead encounter. Skeletons are CR 1/4, vulnerable to bludgeoning. ' +
                 'Cleric Sacred Flame (radiant) is effective.',
    build: () => ({
      party:   [ pc('Fighter',0), pc('Cleric',2), pc('Paladin',4), pc('Ranger',6) ],
      enemies: [
        monster('Skeleton',1,10,'attackNearest'), monster('Skeleton',3,10,'attackNearest'),
        monster('Skeleton',5,10,'attackNearest'), monster('Skeleton',7,10,'attackNearest'),
      ],
    }),
  },

  {
    id: 'party4-vs-zombies',
    name: 'Party of 4 vs 4 Zombies',
    description: 'Zombies have Undead Fortitude (CON save to drop to 1 HP instead of 0). ' +
                 'Tests sustained damage vs. the save mechanic.',
    build: () => ({
      party:   [ pc('Fighter',0), pc('Barbarian',2), pc('Cleric',4), pc('Warlock',6) ],
      enemies: [
        monster('Zombie',1,10,'attackNearest'), monster('Zombie',3,10,'attackNearest'),
        monster('Zombie',5,10,'attackNearest'), monster('Zombie',7,10,'attackNearest'),
      ],
    }),
  },

  {
    id: 'fighter-vs-orc',
    name: 'Fighter vs Orc (1v1 classic)',
    description: 'Level-1 Fighter vs an Orc (CR 1/2). Aggressive Orcs attack on sight. ' +
                 'Expect ~50/50 — a real fight for a fresh character.',
    build: () => ({
      party:   [ pc('Fighter', 0) ],
      enemies: [ monster('Orc', 1, 8, 'smart') ],
    }),
  },

  {
    id: 'full-party-vs-ogre',
    name: 'Full Party of 4 vs Ogre (CR 2)',
    description: 'Standard "hard" encounter for level 1. Ogre has 59 HP and +6 to hit. ' +
                 'Party needs coordination to survive.',
    build: () => ({
      party: [ pc('Fighter',0), pc('Cleric',2), pc('Rogue',4), pc('Wizard',6) ],
      enemies: [ monster('Ogre', 3, 10, 'attackNearest') ],
      mapWidth: 12,
    }),
  },

  // ---- Mounted combat presets ----

  {
    id: 'paladin-on-warhorse-vs-goblins',
    name: 'Paladin on Warhorse vs 3 Goblins',
    description: 'Level-1 Paladin mounted on a Warhorse vs 3 Goblins. ' +
                 'Classic knightly charge scenario. Warhorse contributes Hooves attacks. ' +
                 'Run with: npx ts-node src/index.ts paladin-on-warhorse-vs-goblins',
    build: () => {
      const { monsterToCombatant, loadBestiaryJson } = require('../parser/fivetools');
      const { setupMount } = require('../summons/mount');
      const fs   = require('fs');
      const path = require('path');

      const bPaths = [
        path.join(__dirname, '../../bestiaryData/bestiary-mm-2014.json'),
        path.join(__dirname, '../../bestiaryData/bestiary-mm.json'),
      ].filter((p: string) => fs.existsSync(p));
      if (bPaths.length === 0) throw new Error('MM bestiary not found in bestiaryData/');

      const fullMap = loadBestiaryJson(JSON.parse(fs.readFileSync(bPaths[0], 'utf-8')));

      const paladin   = pc('Paladin', 0);
      const warhorseRaw = fullMap.get('warhorse');
      if (!warhorseRaw) throw new Error('Warhorse not in bestiary');
      const warhorse  = monsterToCombatant(warhorseRaw, { x: 0, y: 0, z: 0 }, 'smart', 'enemy', 19);
      warhorse.faction = 'party';

      return {
        party:   [ paladin, warhorse ],
        enemies: [
          monster('Goblin', 2, 10, 'smart'),
          monster('Goblin', 4, 10, 'smart'),
          monster('Goblin', 6, 10, 'smart'),
        ],
      };
    },
  },

  {
    id: 'fighter-on-warhorse-vs-orc',
    name: 'Fighter on Warhorse vs Orc (mounted 1v1)',
    description: 'Fighter mounted on Warhorse vs Orc. ' +
                 'Compare with fighter-vs-orc to see mounted combat advantage. ' +
                 '(Without mount: ~53% party wins. With Warhorse: much higher.)',
    build: () => {
      const { monsterToCombatant, loadBestiaryJson } = require('../parser/fivetools');
      const fs   = require('fs');
      const path = require('path');

      const bPaths = [
        path.join(__dirname, '../../bestiaryData/bestiary-mm-2014.json'),
        path.join(__dirname, '../../bestiaryData/bestiary-mm.json'),
      ].filter((p: string) => fs.existsSync(p));
      if (bPaths.length === 0) throw new Error('MM bestiary not found');

      const fullMap = loadBestiaryJson(JSON.parse(fs.readFileSync(bPaths[0], 'utf-8')));
      const fighter   = pc('Fighter', 0);
      const warhorseRaw = fullMap.get('warhorse');
      if (!warhorseRaw) throw new Error('Warhorse not in bestiary');
      const warhorse  = monsterToCombatant(warhorseRaw, { x: 0, y: 0, z: 0 }, 'attackNearest', 'enemy', 19);
      warhorse.faction = 'party';

      return {
        party:   [ fighter, warhorse ],
        enemies: [ monster('Orc', 1, 8, 'smart') ],
      };
    },
  },


];

/** Get a preset by ID. Throws if not found. */
export function getPreset(id: string): Preset {
  const p = PRESETS.find(p => p.id === id);
  if (!p) throw new Error(`Preset not found: ${id}. Available: ${PRESETS.map(p => p.id).join(', ')}`);
  return p;
}
