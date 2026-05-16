// ============================================================
// Summon Spawner (Phase 5.2)
// Instantiates summon-type creatures from the registry + raw
// 5etools stat block, applying HP scaling and profile overrides.
// ============================================================

import { Combatant, Vec3, AIProfile }           from '../types/core';
import { Raw5etoolsMonster, monsterToCombatant } from '../parser/fivetools';
import { SummonEntry, getSummonEntry }           from './registry';

// ---- HP resolution ------------------------------------------

/**
 * Resolve HP for a summon at spawn time.
 * @param entry         - registry entry
 * @param summonerMaxHP - the summoner's current maxHP (needed for fraction type)
 * @param casterLevel   - spell slot level or item charge level (1–9)
 */
export function resolveSummonHP(
  entry: SummonEntry,
  summonerMaxHP: number,
  casterLevel: number
): number {
  switch (entry.hp.type) {
    case 'fixed':
      return entry.hp.value;

    case 'byLevel': {
      // Find the closest level at or below casterLevel
      const levels = Object.keys(entry.hp.table).map(Number).sort((a, b) => a - b);
      let hp = entry.hp.table[levels[0]]; // fallback to lowest
      for (const lvl of levels) {
        if (lvl <= casterLevel) hp = entry.hp.table[lvl];
      }
      return hp;
    }

    case 'summonerFraction':
      return Math.floor(summonerMaxHP * entry.hp.fraction);
  }
}

// ---- Main spawn function ------------------------------------

export interface SpawnSummonOptions {
  pos?:           Vec3;
  faction?:       'enemy' | 'neutral' | 'party';
  /** Override the entry's defaultProfile */
  profileOverride?: AIProfile;
  /** Summoner's maxHP — required for fraction-HP entries */
  summonerMaxHP?: number;
  /** Spell slot / item level used to summon */
  casterLevel?:   number;
}

/**
 * Spawn a summon-type creature using a registry entry + raw stat block.
 *
 * @param rawBestiary - full loaded bestiary map (from loadBestiaryJson or loadBestiaryDir)
 * @param name        - creature name (must match registry and bestiary)
 * @param options     - spawn configuration
 *
 * Returns null if: name not in registry, name not in rawBestiary, or HP cannot be resolved.
 */
export function spawnSummon(
  rawBestiary: Map<string, Raw5etoolsMonster>,
  name: string,
  options: SpawnSummonOptions = {}
): Combatant | null {
  const entry = getSummonEntry(name);
  if (!entry) {
    console.warn(`spawnSummon: "${name}" not in SUMMON_REGISTRY. Add an entry first.`);
    return null;
  }

  const raw = rawBestiary.get(name.toLowerCase());
  if (!raw) {
    console.warn(`spawnSummon: "${name}" not found in bestiary map. Add the JSON file to bestiaryData/.`);
    return null;
  }

  const pos          = options.pos          ?? { x: 0, y: 0, z: 0 };
  const faction      = options.faction      ?? 'enemy';
  const profile      = options.profileOverride ?? entry.defaultProfile;
  const summonerHP   = options.summonerMaxHP ?? 20; // safe default
  const casterLevel  = options.casterLevel  ?? 1;

  const hp = resolveSummonHP(entry, summonerHP, casterLevel);

  // monsterToCombatant only accepts 'enemy' | 'neutral'; override faction after if 'party'
  const spawnFaction: 'enemy' | 'neutral' = faction === 'party' ? 'enemy' : faction;
  const combatant = monsterToCombatant(raw, pos, profile, spawnFaction, hp);
  if (faction === 'party') combatant.faction = 'party';

  // Tag as summon for engine/reporting purposes
  (combatant as any).isSummon = true;
  (combatant as any).summonEntry = entry;

  return combatant;
}

/**
 * Issue a verbal command to a summon already on the battlefield.
 * Sets the pendingCommands entry so the engine applies it at the
 * start of the summon's next turn (no action cost, per RAW).
 *
 * @param battlefield    - active battlefield
 * @param summonId       - the summon's combatant ID
 * @param newProfile     - profile to switch to ('attackNearest', 'defend', etc.)
 */
export function issueVerbalCommand(
  battlefield: { pendingCommands?: Map<string, AIProfile> },
  summonId: string,
  newProfile: AIProfile
): void {
  if (!battlefield.pendingCommands) {
    battlefield.pendingCommands = new Map();
  }
  battlefield.pendingCommands.set(summonId, newProfile);
}
