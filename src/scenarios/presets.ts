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

  // ---- Presets that require additional bestiary files ----
  // Uncomment as you add files to bestiaryData/:

  // {
  //   id: 'party4-vs-goblin-band',
  //   name: 'Party of 4 vs 4 Goblins',
  //   description: 'Classic CR 1/4 encounter. Goblins use Nimble Escape (bonus disengage).',
  //   build: () => ({
  //     party:   [ pc('Fighter',0), pc('Rogue',2), pc('Cleric',4), pc('Wizard',6) ],
  //     enemies: [ monster('Goblin',1,10), monster('Goblin',3,10),
  //                monster('Goblin',5,10), monster('Goblin',7,10) ],
  //   }),
  // },

];

/** Get a preset by ID. Throws if not found. */
export function getPreset(id: string): Preset {
  const p = PRESETS.find(p => p.id === id);
  if (!p) throw new Error(`Preset not found: ${id}. Available: ${PRESETS.map(p => p.id).join(', ')}`);
  return p;
}
