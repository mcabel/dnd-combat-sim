// ============================================================
// CR-Based Creature Picker (Phase 2 — TG-006)
// Picks creatures from a bestiary map by CR and type constraints.
//
// PHB Conjure spells (Conjure Animals, Conjure Woodland Beings,
// Conjure Minor Elementals, Conjure Elemental, Conjure Fey,
// Conjure Celestial) select creatures from the Monster Manual
// by CR, unlike TCE spells which have hardcoded stat blocks.
//
// USAGE:
//   import { pickCreaturesByCR, parseCR } from '../summons/cr_picker';
//   const picks = pickCreaturesByCR(bestiary, 0.25, 'beast', 2);
//   // → [{ name: 'Wolf', cr: 0.25 }, { name: 'Wolf', cr: 0.25 }]
//
// NOTE: The current runtime spell modules (Conjure Animals v1)
// hardcode their stat blocks rather than loading from bestiary,
// because the bestiary may not be available in all contexts.
// This picker is infrastructure for future use when bestiary
// loading is standardised at combat-setup time.
// ============================================================

import { Raw5etoolsMonster } from '../parser/fivetools';

// ---- Types --------------------------------------------------

export interface PickResult {
  name: string;
  cr: number;
}

// ---- CR parsing ---------------------------------------------

/**
 * Parse a CR value from 5etools JSON format.
 *
 * 5etools CR can be:
 *   - A string like "1/4", "1/2", "1", "2", "0"
 *   - An object like { cr: "1/4" }  (used for lair/inherited CR)
 *   - Missing/undefined (returns null)
 *
 * Returns a numeric value (0.125 for "1/8", 0.25 for "1/4", etc.)
 * or null if the CR cannot be parsed.
 */
export function parseCR(raw: string | { cr: string } | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;

  let crStr: string;
  if (typeof raw === 'string') {
    crStr = raw;
  } else if (typeof raw === 'object' && typeof raw.cr === 'string') {
    crStr = raw.cr;
  } else {
    return null;
  }

  // Handle fraction CRs
  if (crStr === '0' || crStr === '0.0') return 0;
  if (crStr === '1/8') return 0.125;
  if (crStr === '1/4') return 0.25;
  if (crStr === '1/2') return 0.5;

  // Handle whole-number CRs
  const num = parseFloat(crStr);
  if (!isNaN(num) && num >= 0) return num;

  return null;
}

// ---- CR picker ----------------------------------------------

/**
 * Pick creatures from a bestiary map by CR and type constraints.
 * Returns names of creatures that match the criteria.
 *
 * @param bestiary     - loaded bestiary map (from loadBestiaryJson)
 * @param maxCR        - maximum challenge rating (inclusive)
 * @param creatureType - optional type filter (e.g. 'beast', 'fey', 'elemental')
 * @param count        - number of creatures to pick
 * @returns array of PickResult (name + cr)
 */
export function pickCreaturesByCR(
  bestiary: Map<string, Raw5etoolsMonster>,
  maxCR: number,
  creatureType: string | null,
  count: number
): PickResult[] {
  // Filter the bestiary by CR and type
  const candidates: PickResult[] = [];
  for (const [, raw] of bestiary) {
    const cr = parseCR(raw.cr);
    if (cr === null || cr > maxCR) continue;
    if (creatureType) {
      const type = typeof raw.type === 'string'
        ? raw.type.toLowerCase()
        : (typeof raw.type === 'object' && raw.type ? (raw.type as any).type?.toLowerCase?.() ?? '' : '');
      if (type !== creatureType.toLowerCase()) continue;
    }
    candidates.push({ name: raw.name, cr });
  }

  // Sort by CR descending (prefer higher CR within the limit)
  candidates.sort((a, b) => b.cr - a.cr);

  // Pick the top `count` creatures (v1: just pick the strongest)
  return candidates.slice(0, count);
}

// ---- Conjure Animals option table ---------------------------

/**
 * PHB p.225 — Conjure Animals CR/count options.
 * Each entry defines one valid (maxCR, count) pair.
 */
export const CONJURE_ANIMALS_OPTIONS: readonly { maxCR: number; count: number; label: string }[] = [
  { maxCR: 2,    count: 1, label: 'One beast of CR 2' },
  { maxCR: 1,    count: 2, label: 'Two beasts of CR 1' },
  { maxCR: 0.5,  count: 3, label: 'Three beasts of CR 1/2' },
  { maxCR: 0.25, count: 4, label: 'Four beasts of CR 1/4' },
  { maxCR: 0.25, count: 8, label: 'Eight beasts of CR 1/4' },
] as const;

/**
 * Default Conjure Animals option for v1: 2 wolves (CR 1/4 × 2).
 * This is the most iconic and commonly chosen option.
 */
export const DEFAULT_CA_OPTION = CONJURE_ANIMALS_OPTIONS[1]; // Two beasts of CR 1
