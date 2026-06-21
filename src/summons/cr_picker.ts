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

// ---- Conjure Woodland Beings option table -------------------

/**
 * PHB p.228 — Conjure Woodland Beings CR/count options.
 * 4th-level conjuration. Each entry is one valid (maxCR, count) pair.
 */
export const CONJURE_WOODLAND_BEINGS_OPTIONS: readonly { maxCR: number; count: number; label: string }[] = [
  { maxCR: 2,    count: 1, label: 'One fey of CR 2' },
  { maxCR: 1,    count: 2, label: 'Two fey of CR 1' },
  { maxCR: 0.5,  count: 4, label: 'Four fey of CR 1/2' },
  { maxCR: 0.25, count: 8, label: 'Eight fey of CR 1/4' },
] as const;

/**
 * Default Conjure Woodland Beings option for v1: 4 Sprites (CR 1/4).
 * Sprites are the most combat-capable CR 1/4 fey in the Monster Manual
 * (MM p.340) — they have both a melee longsword and a ranged shortbow
 * with a poisoned arrow effect. v1 spawns 4 of them for a manageable
 * battlefield footprint (instead of the listed maximum of 8).
 */
export const DEFAULT_CWB_OPTION = CONJURE_WOODLAND_BEINGS_OPTIONS[3]; // Eight fey of CR 1/4

// ---- Conjure Minor Elementals option table ------------------

/**
 * PHB p.226 — Conjure Minor Elementals CR/count options.
 * 4th-level conjuration. Same option structure as Conjure Woodland Beings.
 */
export const CONJURE_MINOR_ELEMENTALS_OPTIONS: readonly { maxCR: number; count: number; label: string }[] = [
  { maxCR: 2,    count: 1, label: 'One elemental of CR 2' },
  { maxCR: 1,    count: 2, label: 'Two elementals of CR 1' },
  { maxCR: 0.5,  count: 4, label: 'Four elementals of CR 1/2' },
  { maxCR: 0.25, count: 8, label: 'Eight elementals of CR 1/4' },
] as const;

/**
 * Default Conjure Minor Elementals option for v1: 4 Mud Mephits (CR 1/4).
 * Mud Mephits (MM p.215) are the most well-rounded CR 1/4 elemental —
 * AC 11, HP 27 (highest of the CR 1/4 mephits), Fists +3 1d6+1 bludgeoning
 * plus a recharge Mud Breath (restrains Medium or smaller on DC 11 DEX).
 * v1 spawns 4 of them for a manageable battlefield footprint.
 */
export const DEFAULT_CME_OPTION = CONJURE_MINOR_ELEMENTALS_OPTIONS[3]; // Eight elementals of CR 1/4

// ---- Conjure Elemental option table -------------------------

/**
 * PHB p.225 — Conjure Elemental CR/count options.
 * 5th-level conjuration. Unlike the L4 Conjure spells, Conjure Elemental
 * summons a single elemental whose CR scales with the slot level used:
 *   L5: CR 5 or lower
 *   L6: CR 6 or lower
 *   L7: CR 7 or lower
 *   L8: CR 8 or lower
 *   L9: CR 9 or lower
 * The maxCR equals the slot level. Each entry here is keyed by slot level.
 */
export const CONJURE_ELEMENTAL_OPTIONS: readonly { slotLevel: number; maxCR: number; label: string }[] = [
  { slotLevel: 5, maxCR: 5, label: 'L5: one elemental of CR 5' },
  { slotLevel: 6, maxCR: 6, label: 'L6: one elemental of CR 6' },
  { slotLevel: 7, maxCR: 7, label: 'L7: one elemental of CR 7' },
  { slotLevel: 8, maxCR: 8, label: 'L8: one elemental of CR 8' },
  { slotLevel: 9, maxCR: 9, label: 'L9: one elemental of CR 9' },
] as const;

/**
 * Default Conjure Elemental option for v1: L5 → 1 Fire Elemental (CR 5).
 * Fire Elemental (MM p.125) is the iconic combat option — Touch +6 2d6+3
 * fire with Multiattack (2 touches), and the Fire Form trait ignites
 * flammable targets and lets the elemental move through hostile spaces.
 */
export const DEFAULT_CE_OPTION = CONJURE_ELEMENTAL_OPTIONS[0]; // L5: CR 5

// ---- Conjure Fey option table --------------------------------

/**
 * PHB p.226 — Conjure Fey CR/count options.
 * 6th-level conjuration. Summons a single fey whose CR scales with slot
 * level: L6 → CR 6, L7 → CR 7, L8 → CR 8, L9 → CR 9.
 */
export const CONJURE_FEY_OPTIONS: readonly { slotLevel: number; maxCR: number; label: string }[] = [
  { slotLevel: 6, maxCR: 6, label: 'L6: one fey of CR 6' },
  { slotLevel: 7, maxCR: 7, label: 'L7: one fey of CR 7' },
  { slotLevel: 8, maxCR: 8, label: 'L8: one fey of CR 8' },
  { slotLevel: 9, maxCR: 9, label: 'L9: one fey of CR 9' },
] as const;

/**
 * Default Conjure Fey option for v1: L6 → 1 Green Hag (CR 3).
 * Green Hag (MM p.177) is the highest-CR fey in the Monster Manual that
 * fits within the L6 cap (CR ≤ 6). Although the spell allows up to CR 6,
 * no CR 6 fey exists in the MM 2014 — the Green Hag (CR 3) is the
 * strongest MM fey and a reasonable v1 default. A future v2 should pull
 * from a wider bestiary (e.g. Yeth Hound CR 4 from MTF, Korred CR 4 from
 * VGM, Bard CR 4 from VGM) when bestiary loading is standardised.
 *
 * Green Hag stats: AC 17 (natural armor), HP 82, Claws +6 2d8+4 slashing.
 */
export const DEFAULT_CF_OPTION = CONJURE_FEY_OPTIONS[0]; // L6: CR 6

// ---- Conjure Celestial option table --------------------------

/**
 * PHB p.225 — Conjure Celestial CR/count options.
 * 7th-level conjuration. Summons a single celestial whose CR scales with
 * slot level: L7 → CR 4, L8 → CR 5, L9 → CR 6. (Note: the CR progression
 * starts at CR 4 for L7 and increases by 1 per slot level above 7th,
 * unlike Conjure Fey/Elemental which start at CR = slotLevel.)
 */
export const CONJURE_CELESTIAL_OPTIONS: readonly { slotLevel: number; maxCR: number; label: string }[] = [
  { slotLevel: 7, maxCR: 4, label: 'L7: one celestial of CR 4' },
  { slotLevel: 8, maxCR: 5, label: 'L8: one celestial of CR 5' },
  { slotLevel: 9, maxCR: 6, label: 'L9: one celestial of CR 6' },
] as const;

/**
 * Default Conjure Celestial option for v1: L7 → 1 Couatl (CR 4).
 * Couatl (MM p.43) is the only CR 4 celestial in the Monster Manual and
 * therefore the canonical L7 default — AC 19 (natural armor), HP 97,
 * Bite +8 1d6+5 piercing + DC 13 CON save or unconscious (poisoned),
 * Constrict +6 2d6+3 + grapple/restrain (DC 15).
 */
export const DEFAULT_CC_OPTION = CONJURE_CELESTIAL_OPTIONS[0]; // L7: CR 4
