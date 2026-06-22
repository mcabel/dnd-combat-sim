// ============================================================
// summon_picker.ts — Bestiary-driven summon selection
//
// Session 41 Task #3: wires cr_picker.ts + monsterToCombatant to the
// actual bestiary JSON so Conjure spells can pick higher-CR creatures
// based on slot level for their upcast paths.
//
// Design:
//   - The bestiary is loaded LAZILY on first access via loadBestiaryDir.
//     This avoids a startup hit when the runtime doesn't need summons
//     (e.g. PC-vs-PC arena tests).
//   - The loader path defaults to './bestiaryData' (relative to CWD).
//     This matches the existing project layout.
//   - Each Conjure spell's execute() calls pickSummonByLevel() with
//     its slot level and a creature-type filter. The helper returns
//     either a Raw5etoolsMonster (caller converts via monsterToCombatant)
//     or null (caller falls back to its hardcoded stat block).
//   - The CR picker prefers the HIGHEST-CR creature of the matching
//     type within the maxCR cap. Ties are broken alphabetically by
//     name for deterministic output.
//
// Why a separate module (not inline in each Conjure spell):
//   - Multiple Conjure spells share the same bestiary-loading logic.
//   - Centralising it here makes the bestiary cache reusable across
//     Conjure Celestial / Elemental / Fey / Animals / etc.
//   - Tests can mock the bestiary by calling setBestiaryForTesting()
//     with a pre-built map.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Raw5etoolsMonster, monsterToCombatant, mergeBestiaries } from '../parser/fivetools';
import { parseCR } from './cr_picker';
import { Combatant, AIProfile, Vec3 } from '../types/core';

// ---- Bestiary cache (lazy-loaded) ---------------------------

let _bestiaryCache: Map<string, Raw5etoolsMonster> | null = null;
let _bestiaryLoadError: string | null = null;

/**
 * Default bestiary directory (relative to CWD). The project ships
 * bestiaryData/ at the repo root with bestiary-mm-2014.json,
 * bestiary-mm.json, and bestiary-dmg.json.
 */
export const DEFAULT_BESTIARY_DIR = './bestiaryData';

/**
 * Load the bestiary from the given directory (or the default if not
 * specified). The result is cached for the lifetime of the process.
 *
 * Returns a Map keyed by lowercase monster name. Returns an empty Map
 * if the directory doesn't exist or contains no valid JSON files
 * (logs a warning to stderr but does NOT throw — callers should fall
 * back to their hardcoded stat blocks).
 */
export function loadBestiary(dirPath: string = DEFAULT_BESTIARY_DIR): Map<string, Raw5etoolsMonster> {
  if (_bestiaryCache !== null) return _bestiaryCache;

  const absDir = path.resolve(dirPath);
  if (!fs.existsSync(absDir)) {
    _bestiaryLoadError = `Bestiary directory not found: ${absDir}`;
    console.warn(`[summon_picker] ${_bestiaryLoadError} — falling back to hardcoded stat blocks`);
    _bestiaryCache = new Map();
    return _bestiaryCache;
  }

  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.json'));
  const loaded: { monster: Raw5etoolsMonster[] }[] = [];

  for (const file of files.sort()) {
    const filePath = path.join(absDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(data.monster)) {
        loaded.push({ monster: data.monster });
      }
    } catch (e) {
      console.warn(`[summon_picker] Failed to parse ${file}: ${(e as Error).message}`);
    }
  }

  _bestiaryCache = loaded.length > 0 ? mergeBestiaries(...loaded) : new Map();
  return _bestiaryCache;
}

/**
 * Get the cached bestiary (loads on first call).
 * Returns an empty Map if loading failed (callers should fall back
 * to hardcoded stat blocks).
 */
export function getBestiary(): Map<string, Raw5etoolsMonster> {
  return loadBestiary();
}

/**
 * Test-only: inject a pre-built bestiary map. Pass null to clear the
 * cache and force a reload on next getBestiary() call.
 */
export function setBestiaryForTesting(map: Map<string, Raw5etoolsMonster> | null): void {
  _bestiaryCache = map;
  _bestiaryLoadError = null;
}

/**
 * Returns the error message from the last bestiary load attempt, or
 * null if loading succeeded (or hasn't been attempted yet).
 */
export function getBestiaryLoadError(): string | null {
  return _bestiaryLoadError;
}

// ---- Summon picker ------------------------------------------

export interface SummonPick {
  /** Monster name (canonical case from bestiary). */
  name: string;
  /** Numeric CR (0.125 for "1/8", etc.). */
  cr: number;
  /** The raw 5etools monster entry (for monsterToCombatant). */
  raw: Raw5etoolsMonster;
}

/**
 * Pick the highest-CR creature of the given type within the maxCR cap.
 *
 * Ties are broken alphabetically by name for deterministic output.
 * Returns null if no matching creature is found.
 *
 * @param bestiary     - loaded bestiary map (from getBestiary())
 * @param maxCR        - maximum challenge rating (inclusive)
 * @param creatureType - creature type filter (e.g. 'celestial', 'fey', 'elemental', 'beast')
 *                       case-insensitive
 * @returns SummonPick or null
 */
export function pickSummonByCR(
  bestiary: Map<string, Raw5etoolsMonster>,
  maxCR: number,
  creatureType: string,
): SummonPick | null {
  const candidates: SummonPick[] = [];

  for (const [, raw] of bestiary) {
    // Type filter
    const rawType = typeof raw.type === 'string'
      ? raw.type
      : (typeof raw.type === 'object' && raw.type ? (raw.type as any).type ?? '' : '');
    if (rawType.toLowerCase() !== creatureType.toLowerCase()) continue;

    // CR filter
    const cr = parseCR(raw.cr);
    if (cr === null || cr > maxCR) continue;

    candidates.push({ name: raw.name, cr, raw });
  }

  if (candidates.length === 0) return null;

  // Sort by CR descending, then alphabetically by name for determinism
  candidates.sort((a, b) => {
    if (b.cr !== a.cr) return b.cr - a.cr;
    return a.name.localeCompare(b.name);
  });

  return candidates[0];
}

/**
 * Pick a summon by exact name. Returns null if not in the bestiary.
 *
 * Useful for Conjure Celestial L7 (always Couatl) where the spell
 * has a canonical creature rather than a CR-based pick.
 */
export function pickSummonByName(
  bestiary: Map<string, Raw5etoolsMonster>,
  name: string,
): SummonPick | null {
  const raw = bestiary.get(name.toLowerCase());
  if (!raw) return null;
  const cr = parseCR(raw.cr);
  if (cr === null) return null;
  return { name: raw.name, cr, raw };
}

// ---- Conjure Celestial picker --------------------------------

/**
 * Pick the Conjure Celestial summon for the given slot level.
 *
 * PHB p.225 — Conjure Celestial CR progression:
 *   L7 → CR 4 (Couatl)
 *   L8 → CR 5 (Unicorn in MM)
 *   L9 → CR 6 (no CR 6 celestials in MM; fall back to Couatl)
 *
 * Returns the chosen SummonPick, or null if the bestiary has no
 * valid creature (caller falls back to createCouatl).
 *
 * v1 behavior: L7 always returns Couatl (the only CR 4 celestial in MM).
 * v1.5 behavior (Session 41 Task #3): L8 returns Unicorn (CR 5) if
 * the bestiary is loaded; otherwise null (fall back to Couatl).
 * L9 returns null in MM (no CR 6 celestials) — caller falls back to Couatl.
 */
export function pickConjureCelestialSummon(slotLevel: number): SummonPick | null {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return null; // bestiary not loaded

  // CR cap per slot level (PHB p.225)
  const maxCR = 4 + (slotLevel - 7); // L7=4, L8=5, L9=6
  if (maxCR < 4) return null; // sanity check (slotLevel < 7 shouldn't happen)

  // L7: always Couatl (canonical choice, only CR 4 celestial in MM)
  if (slotLevel === 7) {
    return pickSummonByName(bestiary, 'Couatl');
  }

  // L8/L9: pick the highest-CR celestial within the cap
  return pickSummonByCR(bestiary, maxCR, 'celestial');
}

// ---- Conjure Elemental picker --------------------------------

/**
 * Pick the Conjure Elemental summon for the given slot level.
 *
 * PHB p.225 — Conjure Elemental CR progression:
 *   L5 → CR 5 (Air/Earth/Fire/Water Elemental, Salamander, Xorn)
 *   L6 → CR 6 (Galeb Duhr, Invisible Stalker)
 *   L7-L9 → no CR 7-9 elementals in MM; fall back to CR 6
 *
 * Returns the chosen SummonPick, or null if the bestiary has no
 * valid creature (caller falls back to createFireElemental).
 */
export function pickConjureElementalSummon(slotLevel: number): SummonPick | null {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return null;

  const maxCR = Math.min(slotLevel, 9); // L5=5, L6=6, L7-L9 capped at 9
  // Pick highest-CR elemental within the cap
  return pickSummonByCR(bestiary, maxCR, 'elemental');
}

// ---- Conjure Fey picker --------------------------------------

/**
 * Pick the Conjure Fey summon for the given slot level.
 *
 * PHB p.226 — Conjure Fey CR progression:
 *   L6 → CR 6 (no CR 6 fey in MM; highest is Green Hag CR 3)
 *   L7-L9 → same problem
 *
 * Returns the chosen SummonPick (Green Hag CR 3 in MM), or null if
 * the bestiary has no valid creature.
 */
export function pickConjureFeySummon(slotLevel: number): SummonPick | null {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return null;

  const maxCR = Math.min(slotLevel, 9);
  return pickSummonByCR(bestiary, maxCR, 'fey');
}

// ---- Combatant builder (from bestiary pick) ------------------

/**
 * Convert a SummonPick into a Combatant, configured as a summon
 * (isSummon=true, summonerId set, faction inherited from caster).
 *
 * This is a thin wrapper around monsterToCombatant that adds the
 * summon-specific fields after construction.
 */
export function buildSummonCombatant(
  pick: SummonPick,
  caster: Combatant,
  spellName: string,
  pos?: Vec3,
  profile: AIProfile = 'smart',
): Combatant {
  // Position: adjacent to caster (1 square away) if not specified
  const summonPos: Vec3 = pos ?? {
    x: caster.pos.x + 1,
    y: caster.pos.y,
    z: caster.pos.z,
  };

  const combatant = monsterToCombatant(pick.raw, summonPos, profile, caster.faction as 'enemy' | 'neutral');

  // Patch identity + summon fields
  combatant.id = `${spellName.toLowerCase().replace(/\s+/g, '_')}_${pick.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  combatant.name = `${pick.name} (${caster.name})`;
  combatant.faction = caster.faction;
  combatant.isSummon = true;
  combatant.summonerId = caster.id;
  combatant.summonSpellName = spellName;

  return combatant;
}
