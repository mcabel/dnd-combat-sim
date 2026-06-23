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
import { Raw5etoolsMonster, monsterToCombatant, mergeBestiaries, rawCreatureType } from '../parser/fivetools';
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
    // Type filter — Session 53: use rawCreatureType() to handle every
    // 5etools type shape (string, {type:string}, {type:string[]},
    // {type:{choose:[...]}}, {choose:[...]}). The old `raw.type as any`
    // path crashed on `{ type: { choose: [...] } }` (bestiary-mpp.json).
    const rawType = rawCreatureType(raw.type);
    if (rawType !== creatureType.toLowerCase()) continue;

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

// ---- Conjure Animals picker (Session 43 Task #21) ------------

/**
 * Pick the Conjure Animals summon for the given slot level.
 *
 * PHB p.225 — Conjure Animals CR progression (1-creature option):
 *   L3 → CR 2 (e.g. Giant Constrictor Snake, Polar Bear)
 *   L4 → CR 3 (e.g. Ankylosaurus, Knight — but knight is humanoid)
 *   L5 → CR 4 (e.g. Elephant, Stegoceras)
 *   L6 → CR 5 (e.g. Triceratops, Tyrannosaurus Rex is CR 8 — too high)
 *   L7 → CR 6 (e.g. Mammoth)
 *   L8 → CR 7 (e.g. Giant Ape)
 *   L9 → CR 8 (e.g. Tyrannosaurus Rex)
 *
 * v1 simplification: always picks the "1 creature at max CR" option.
 * PHB also offers 2/4/8 creatures at lower CRs — not modelled in v1.
 *
 * Returns the chosen SummonPick (highest-CR beast ≤ maxCR), or null
 * if the bestiary has no valid creature (caller falls back to Wolf).
 */
export function pickConjureAnimalsSummon(slotLevel: number): SummonPick | null {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return null;

  // PHB p.225: maxCR = slotLevel - 1 (L3=CR2, L4=CR3, ..., L9=CR8)
  const maxCR = slotLevel - 1;
  if (maxCR < 0) return null;
  return pickSummonByCR(bestiary, maxCR, 'beast');
}

// ---- Conjure Woodland Beings picker (Session 43 Task #21) ----

/**
 * Pick the Conjure Woodland Beings summon for the given slot level.
 *
 * PHB p.226 — Conjure Woodland Beings CR progression (1-creature option):
 *   L4 → CR 2 (e.g. Bog Unicorn, Darkling — but CR varies)
 *   L5 → CR 3 (e.g. Green Hag, Sea Hag)
 *   L6 → CR 4 (e.g. Korred, Yeth Hound)
 *   L7 → CR 5 (e.g. Bheur Hag, Pixie is CR 1/4 — depends)
 *   L8 → CR 6 (e.g. Yeth Hound pack — depends)
 *   L9 → CR 7 (limited fey in MM at this CR)
 *
 * v1 simplification: always picks the "1 creature at max CR" option.
 *
 * Returns the chosen SummonPick (highest-CR fey ≤ maxCR), or null
 * if the bestiary has no valid creature (caller falls back to Sprite).
 */
export function pickConjureWoodlandBeingsSummon(slotLevel: number): SummonPick | null {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return null;

  // PHB p.226: maxCR = slotLevel - 2 (L4=CR2, L5=CR3, ..., L9=CR7)
  const maxCR = slotLevel - 2;
  if (maxCR < 0) return null;
  return pickSummonByCR(bestiary, maxCR, 'fey');
}

// ---- Conjure Minor Elementals picker (Session 43 Task #21) ---

/**
 * Pick the Conjure Minor Elementals summon for the given slot level.
 *
 * PHB p.225 — Conjure Minor Elementals CR progression (1-creature option):
 *   L4 → CR 2 (e.g. Gargoyle is elemental CR 2 — but type varies)
 *   L5 → CR 3 (e.g. Water Weird, Salamander is CR 5 — too high)
 *   L6 → CR 4 (e.g. Fire Elemental, Air Elemental)
 *   L7 → CR 5 (e.g. Salamander, Water Elemental is CR 5)
 *   L8 → CR 6 (e.g. Invisible Stalker, Galeb Duhr)
 *   L9 → CR 7 (e.g. Dao, Djinni is CR 11 — too high)
 *
 * v1 simplification: always picks the "1 creature at max CR" option.
 *
 * Returns the chosen SummonPick (highest-CR elemental ≤ maxCR), or
 * null if the bestiary has no valid creature (caller falls back to
 * the v1 hardcoded elemental).
 */
export function pickConjureMinorElementalsSummon(slotLevel: number): SummonPick | null {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return null;

  // PHB p.225: maxCR = slotLevel - 2 (L4=CR2, L5=CR3, ..., L9=CR7)
  const maxCR = slotLevel - 2;
  if (maxCR < 0) return null;
  return pickSummonByCR(bestiary, maxCR, 'elemental');
}

// ── Session 44 Task #28: Multi-creature Conjure spell options ──
//
// PHB Conjure Animals / Woodland Beings / Minor Elementals all offer a
// table of (count, maxCR) options at the base slot level, plus an
// "At Higher Levels" multiplier:
//   - L3/L4 base slot: 1× multiplier
//   - L5/L6: 2× multiplier
//   - L7/L8/L9: 3× multiplier
//
// (PHB p.225 Conjure Animals: "Twice as many with a 5th-level slot,
// three times as many with a 7th-level slot." Same wording on p.226
// for Woodland Beings and Minor Elementals.)
//
// v1 (Session 43 Task #21) always picked the "1 creature at max CR"
// option. This v1.5 adds multi-creature pickers that select the
// "N creatures at CR 1/4" option (8 at base count) for the most
// iconic Pack-Tactics-style swarm loadout (e.g. 8 Wolves at L3).
//
// v1.5 simulation cap: MAX_SUMMONS_PER_CAST = 24. The PHB multiplier
// produces 8 (L3-4), 16 (L5-6), or 24 (L7+) creatures for the "8 at CR 1/4"
// option. Session 44 Task #28 capped at 8 to avoid battlefield bloat.
// Session 45 Task #28-follow-up raised the cap to 16, allowing the L5-6
// upcast to produce the full 16 creatures (PHB-accurate). Session 46
// Task #28-follow-up-2 raises the cap to 24, allowing the L7+ upcast to
// produce the full 24 creatures (PHB-accurate) now that the engine's
// per-turn resolution has been profiled and confirmed to handle 24
// summons in well under 1 second on modern hardware.
//
// The engine already supports batched summon turn-resolution (each
// summon takes its own turn in initiative order), so the cap raise is
// safe from a correctness standpoint. The performance impact is
// acceptable: 24 wolves make 24 attack rolls per round, which the
// engine handles in <1 second on modern hardware.

/** Maximum number of creatures spawned by a single Conjure spell cast. */
export const MAX_SUMMONS_PER_CAST = 24;

/**
 * Compute the PHB "At Higher Levels" multiplier for Conjure spells.
 *
 *   L3, L4 → 1× (base count from the option table)
 *   L5, L6 → 2×
 *   L7, L8, L9 → 3×
 *
 * (PHB p.225: "Twice as many with a 5th-level slot, three times as
 * many with a 7th-level slot." The multiplier applies to ALL options
 * in the PHB table, not just the 8-creature one.)
 */
export function conjureSlotMultiplier(slotLevel: number): number {
  if (slotLevel >= 7) return 3;
  if (slotLevel >= 5) return 2;
  return 1;
}

/**
 * Pick multiple copies of the same creature for a Conjure spell.
 *
 * Returns an array of SummonPick (all identical — same name, CR, raw)
 * with length = min(count, MAX_SUMMONS_PER_CAST). Returns [] if no
 * matching creature is found in the bestiary.
 *
 * Used by the multi-creature Conjure spell options (8 Wolves, 8 Sprites,
 * 8 Mephits, etc.). The caller spawns one Combatant per pick.
 */
export function pickSummonPack(
  maxCR: number,
  creatureType: string,
  count: number,
): SummonPick[] {
  const bestiary = getBestiary();
  if (bestiary.size === 0) return [];

  // Pick the highest-CR creature of the matching type within maxCR.
  // All N creatures in the pack are identical (same species) — this
  // matches PHB "X beasts of CR Y" (the beasts are the same creature).
  const pick = pickSummonByCR(bestiary, maxCR, creatureType);
  if (!pick) return [];

  // Cap at MAX_SUMMONS_PER_CAST (v1.5 simplification).
  const cappedCount = Math.min(count, MAX_SUMMONS_PER_CAST);

  // Build N copies. Each copy is a separate SummonPick object so the
  // caller can spawn N separate Combatants with unique IDs.
  const pack: SummonPick[] = [];
  for (let i = 0; i < cappedCount; i++) {
    pack.push({ name: pick.name, cr: pick.cr, raw: pick.raw });
  }
  return pack;
}

// ---- Conjure Animals multi-picker (Session 44 Task #28) -------

/**
 * Pick a pack of beasts for Conjure Animals at the given slot level.
 *
 * PHB p.225 option table (L3 base):
 *   - One beast of CR 2
 *   - Two beasts of CR 1
 *   - Three beasts of CR 1/2
 *   - Four beasts of CR 1/4
 *   - Eight beasts of CR 1/4
 *
 * v1.5 behaviour: picks the "Eight beasts of CR 1/4" option (the most
 * iconic Conjure Animals loadout — e.g. 8 Wolves with Pack Tactics).
 * The slot-level multiplier (1×/2×/3×) is applied to the count, then
 * capped at MAX_SUMMONS_PER_CAST = 24.
 *
 * Returns an array of SummonPick (all the same beast), or [] if the
 * bestiary is empty or has no CR 1/4 beast. The caller falls back to
 * the single-creature picker or the v1 hardcoded 2-Wolf stat block.
 */
export function pickConjureAnimalsSummonMulti(slotLevel: number): SummonPick[] {
  // PHB option 4: Eight beasts of CR 1/4
  const baseCount = 8;
  const maxCR = 0.25;
  const multiplier = conjureSlotMultiplier(slotLevel);
  return pickSummonPack(maxCR, 'beast', baseCount * multiplier);
}

// ---- Conjure Woodland Beings multi-picker (Session 44 Task #28) -------

/**
 * Pick a pack of fey for Conjure Woodland Beings at the given slot level.
 *
 * PHB p.226 option table (L4 base):
 *   - One fey of CR 2
 *   - Two fey of CR 1
 *   - Four fey of CR 1/2
 *   - Eight fey of CR 1/4
 *
 * v1.5 behaviour: picks the "Eight fey of CR 1/4" option (e.g. 8 Sprites
 * with poisoned arrows). The slot-level multiplier is applied to the
 * count, then capped at MAX_SUMMONS_PER_CAST = 24.
 *
 * Returns an array of SummonPick (all the same fey), or [] if the
 * bestiary is empty or has no CR 1/4 fey.
 */
export function pickConjureWoodlandBeingsSummonMulti(slotLevel: number): SummonPick[] {
  const baseCount = 8;
  const maxCR = 0.25;
  const multiplier = conjureSlotMultiplier(slotLevel);
  return pickSummonPack(maxCR, 'fey', baseCount * multiplier);
}

// ---- Conjure Minor Elementals multi-picker (Session 44 Task #28) -------

/**
 * Pick a pack of elementals for Conjure Minor Elementals at the given slot level.
 *
 * PHB p.225 option table (L4 base):
 *   - One elemental of CR 2
 *   - Two elementals of CR 1
 *   - Four elementals of CR 1/2
 *   - Eight elementals of CR 1/4
 *
 * v1.5 behaviour: picks the "Eight elementals of CR 1/4" option (e.g.
 * 8 Mud Mephits). The slot-level multiplier is applied to the count,
 * then capped at MAX_SUMMONS_PER_CAST = 24.
 *
 * Returns an array of SummonPick (all the same elemental), or [] if
 * the bestiary is empty or has no CR 1/4 elemental.
 */
export function pickConjureMinorElementalsSummonMulti(slotLevel: number): SummonPick[] {
  const baseCount = 8;
  const maxCR = 0.25;
  const multiplier = conjureSlotMultiplier(slotLevel);
  return pickSummonPack(maxCR, 'elemental', baseCount * multiplier);
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
