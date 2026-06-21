// ============================================================
// Plant Growth — PHB p.266
//
// 3rd-level transmutation, 1 action, range 150 ft.
// Duration: Instantaneous.
// Components: V, S.
//
// Effect: This spell channels vitality into plants within a specific
//         area. There are two possible uses for the spell, granting
//         either immediate or long-term benefits.
//
//         The overgrowth option (PHB p.266): "All normal plants in a
//         100-foot radius centered on that point become thick and
//         overgrown. A creature moving through the area must spend
//         4 feet of movement for every 1 foot it moves." (i.e. the
//         area becomes difficult terrain — quarter speed, v1 uses
//         half speed / standard difficult terrain for simplicity.)
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - Radius: PHB says 100-ft radius (half-mile for the other option).
//     v1 uses 100 ft for the overgrowth option.
//   - Movement cost: PHB says "4 feet of movement for every 1 foot"
//     (quarter speed). v1 uses standard difficult terrain (half speed)
//     for consistency with the terrain subsystem. Documented via
//     `plantGrowthQuarterSpeedV1Simplified`.
//   - NOT concentration: PHB p.266 — Plant Growth is Instantaneous.
//     The terrain persists for the combat (no concentration to break).
//   - Duration: Instantaneous means the effect persists indefinitely.
//     v1 has no combat-duration tracker — the terrain_zone effect
//     persists for the entire combat.
//
// Migration note (Session 29): upgraded from the generic forward-compat
// flag pattern (Session 19) to a real terrain_zone spell. Removed the
// `_genericSpellActiveSpells` pattern; now applies a terrain_zone effect
// on the caster with terrainDifficulty: true.
//
// Spell module pattern (radius terrain zone, NO concentration):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (terrain persists for combat, not concentration)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, applyTerrainDifficulty } from '../engine/spell_effects';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Plant Growth',
  level: 3,
  school: 'transmutation',
  rangeFt: 150,
  aoeRadiusFt: 100,                                  // PHB p.266: 100-ft radius overgrowth
  concentration: false,
  castingTime: 'action',
  plantGrowthV1Simplified: true,                      // was forward-compat; now real terrain zone
  plantGrowthDifficultTerrainV1Implemented: true,     // PHB p.266: area becomes difficult terrain
  plantGrowthQuarterSpeedV1Simplified: true,           // PHB: quarter speed; v1: half speed (standard difficult terrain)
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Plant Growth this turn.
 *
 * Preconditions:
 *   - Caster has 'Plant Growth' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least one enemy is within 150 ft (the area needs to affect enemies)
 *   - Caster does NOT already have a Plant Growth terrain_zone active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Plant Growth')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  // Skip if caster already has a Plant Growth terrain zone active
  if (caster.activeEffects.some(e =>
    e.spellName === 'Plant Growth' && e.effectType === 'terrain_zone'
  )) return false;
  // Check for enemies within 150 ft
  const enemies = livingEnemiesOf(caster, bf);
  const hasNearbyEnemy = enemies.some(e => {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    return distFt <= 150;
  });
  return hasNearbyEnemy;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Plant Growth:
 *  1. Consume a 3rd-level spell slot.
 *  2. Apply a terrain_zone effect on the CASTER (not concentration).
 *     The zone has terrainDifficulty: true and a 100-ft radius centered
 *     on the caster's position (the caster chooses a point within range;
 *     v1 centers on the caster for simplicity).
 *  3. Call applyTerrainDifficulty to mark cells as difficult terrain.
 *
 * Plant Growth is NOT concentration (PHB p.266: Instantaneous duration).
 * The difficult terrain persists for the entire combat.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  // Apply terrain_zone effect on the CASTER (NOT concentration).
  // PHB p.266: "All normal plants in a 100-foot radius centered on that
  // point become thick and overgrown." The area becomes difficult terrain.
  // No terrainCondition/terrainSaveAbility — the terrain zone only marks
  // cells as difficult terrain; no save-or-condition mechanic applies.
  const effect = applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Plant Growth',
    effectType: 'terrain_zone',
    payload: {
      terrainRadiusFt: 100,
      terrainCenterX: caster.pos.x,
      terrainCenterY: caster.pos.y,
      terrainCenterZ: caster.pos.z,
      terrainDifficulty: true,
    },
    sourceIsConcentration: false,
  });
  applyTerrainDifficulty(state.battlefield, effect);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Plant Growth! (100-ft radius difficult terrain, no save, instantaneous — persists for combat)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s Plant Growth creates overgrowth! (difficult terrain in 100-ft radius, persists for combat)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — Plant Growth is NOT concentration. The terrain persists
  // for the entire combat. Removal is handled by removeEffectsFromCaster
  // only if the caster dies (all effects from dead casters are cleaned up).
}
