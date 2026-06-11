// ============================================================
// Encounter Builder
// Assembles a Battlefield from party + enemy lists, handles
// positioning, and validates encounter legality.
// ============================================================

import { Combatant, Battlefield, Vec3 } from '../types/core';
import { makeFlatBattlefield } from '../engine/combat';

// ---- Positioning strategies ---------------------------------

/**
 * Spread combatants along a row at a given y offset.
 * Used to auto-position party (y=0) and enemies (y=6, facing them).
 */
function spreadRow(combatants: Combatant[], y: number, startX = 0): void {
  combatants.forEach((c, i) => {
    c.pos = { x: startX + i * 2, y, z: 0 };
  });
}

// ---- Encounter spec -----------------------------------------

export interface EncounterSpec {
  party:   Combatant[];
  enemies: Combatant[];
  /** Grid dimensions in squares. Defaults to auto-sized. */
  mapWidth?:  number;
  mapHeight?: number;
  /**
   * Override starting positions. If omitted, party starts at y=0
   * and enemies at y=mapHeight-1 (opposite side), each spread along x.
   */
  positions?: { id: string; pos: Vec3 }[];
}

export interface Encounter {
  battlefield: Battlefield;
  /** All combatant IDs in the order they were added (not initiative order). */
  allIds: string[];
}

/**
 * Build a ready-to-run Battlefield from an EncounterSpec.
 * Mutates combatant positions if positions[] not provided.
 */
export function buildEncounter(spec: EncounterSpec): Encounter {
  const { party, enemies } = spec;

  if (party.length === 0 && enemies.length === 0) {
    throw new Error('Encounter must have at least one combatant');
  }

  // Auto-size map: wide enough for both sides, deep enough to give starting distance
  const totalWidth = Math.max(
    spec.mapWidth ?? 0,
    Math.max(party.length, enemies.length) * 2 + 2,
    10
  );
  const totalHeight = Math.max(spec.mapHeight ?? 0, 12);

  // Apply positions
  if (spec.positions) {
    const all = [...party, ...enemies];
    for (const override of spec.positions) {
      const c = all.find(x => x.id === override.id);
      if (c) c.pos = { ...override.pos };
    }
  } else {
    spreadRow(party,   0);                         // party along bottom row
    spreadRow(enemies, totalHeight - 2);           // enemies along top row
  }

  // Validate: no two combatants on the same square
  const seen = new Map<string, string>();
  for (const c of [...party, ...enemies]) {
    const key = `${c.pos.x},${c.pos.y},${c.pos.z}`;
    if (seen.has(key)) {
      throw new Error(
        `Position collision at (${c.pos.x},${c.pos.y}): ${seen.get(key)} and ${c.id}`
      );
    }
    seen.set(key, c.id);
  }

  const all = [...party, ...enemies];
  const bf  = makeFlatBattlefield(totalWidth, totalHeight, all);

  return { battlefield: bf, allIds: all.map(c => c.id) };
}


import { PlayerResources } from '../types/core';

/** Deep-reset all resource pools to max (for simulation re-runs). */
function resetResources(r: PlayerResources): PlayerResources {
  const out: PlayerResources = {};
  if (r.spellSlots) {
    out.spellSlots = {};
    for (const [lvl, slot] of Object.entries(r.spellSlots)) {
      out.spellSlots[parseInt(lvl)] = { max: slot.max, remaining: slot.max };
    }
  }
  if (r.pactSlots)          out.pactSlots = { ...r.pactSlots, remaining: r.pactSlots.max };
  if (r.rage)               out.rage = { ...r.rage, remaining: r.rage.max, active: false, roundsRemaining: 0 };
  if (r.secondWind)         out.secondWind = { ...r.secondWind, remaining: r.secondWind.max };
  if (r.bardicInspiration)  out.bardicInspiration = { ...r.bardicInspiration, remaining: r.bardicInspiration.max };
  if (r.layOnHands)         out.layOnHands = { ...r.layOnHands, remaining: r.layOnHands.pool };
  if (r.divineSmite !== undefined) out.divineSmite = r.divineSmite;
  if (r.sneakAttackDice)    out.sneakAttackDice = r.sneakAttackDice;
  if (r.arcaneRecovery)     out.arcaneRecovery = { usesRemaining: 1 };
  if (r.darkOnesBlessing)   out.darkOnesBlessing = { ...r.darkOnesBlessing };
  if (r.ammo) {
    out.ammo = {};
    for (const [k, v] of Object.entries(r.ammo)) {
      out.ammo[k] = { max: v.max, remaining: v.max };
    }
  }
  if (r.hitDice)            out.hitDice = { ...r.hitDice, remaining: r.hitDice.max };
  return out;
}

/**
 * Shallow-clone a Combatant with reset HP, budget, conditions, and perception.
 * Used to re-run an encounter from the same starting configuration.
 */
export function resetCombatant(c: Combatant): Combatant {
  return {
    ...c,
    currentHP:  c.maxHP,
    conditions: new Set(),
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: c.isPlayer ? { successes: 0, failures: 0 } : null,
    tempHP: 0,
    resources: c.resources ? resetResources(c.resources) : null,
    usedSneakAttackThisTurn: false,
    isDead:        false,
    isUnconscious: false,
    legendaryActionPool: c.legendaryActionPoolMax,
    budget: {
      movementFt:      c.speed,
      actionUsed:      false,
      bonusActionUsed: false,
      reactionUsed:    false,
      freeObjectUsed:  false,
    },
    // Deep-clone actions so hitBonus overrides in tests don't bleed between runs
    actions: c.actions.map(a => ({ ...a })),
    pos: { ...c.pos },
  };
}
