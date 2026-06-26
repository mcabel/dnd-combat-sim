// ============================================================
// Spike Growth — PHB p.277
//
// 2nd-level transmutation, action, range 150 ft, concentration (10 min).
// Components: V, S, M (seven sharp thorns or seven twigs from a thorn-
//             bearing tree).
//
// Effect: The ground in a 20-foot radius centered on a point within range
//         twists and sprouts hard spikes and thorns. The area becomes
//         difficult terrain. A creature takes 2d4 piercing damage for
//         every 5 feet it moves within the spell's area.
//
//         The transformation of the ground is camouflaged to look natural.
//         Any creature that can't see the area or can't see the caster
//         cast the spell must make a Wisdom (Perception) check against
//         the caster's spell save DC to recognize the terrain as
//         dangerous before moving into it.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - AoE shape: canon 20-ft radius at a point within 150 ft. v1
//     simplification: targets a SINGLE enemy within 150 ft (the zone's
//     center). The zone is canonically a 20-ft radius (40-ft diameter)
//     so it can hit a few clustered creatures, but v1 picks the highest-
//     threat enemy as the zone's center and applies damage to that
//     enemy only. Forward-compat TODO via the metadata flag
//     `spikeGrowthMovementTriggerV1Implemented: false`.
//   - Difficult terrain: PHB p.277 makes the area "difficult terrain"
//     (PHB p.182: movement costs double). v1 has no difficult-terrain
//     subsystem for spell-created zones (the cell-level terrain is
//     static, not effect-driven). Forward-compat TODO via the metadata
//     flag `spikeGrowthDifficultTerrainV1Implemented: false`.
//   - Movement-trigger damage: PHB p.277 says "A creature takes 2d4
//     piercing damage for every 5 feet it moves within the spell's
//     area." v1 does NOT model per-square movement-triggered damage
//     (no movement-event hook). Instead, v1 uses the damage_zone start-
//     of-turn tick (2d4 piercing, NO save — the damage is automatic).
//     This is a v1 simplification — the per-foot movement damage is the
//     canon trigger, but v1 approximates it with the start-of-turn tick
//     (consistent with Cloud of Daggers / Flaming Sphere timing).
//     Documented via the metadata flag
//     `spikeGrowthMovementTriggerV1Implemented: false`.
//   - On cast: PHB p.277 says the damage is triggered by movement into
//     or within the area, NOT by the spell's appearance. v1 does NOT
//     deal on-cast damage (the damage_zone ticks at the start of the
//     target's NEXT turn). This mirrors Cordon of Arrows' v1 pattern.
//   - Perception check (camouflage): v1 has no perception subsystem —
//     the camouflage is moot (no AI check before moving into the zone).
//   - Duration: canon 10 min concentration → v1: concentration is
//     started via startConcentration(), but NOT enforced (TG-002).
//   - No save (PHB p.277: no saving throw listed). The damage is
//     automatic (2d4 piercing per 5 ft moved; v1: 2d4 piercing per turn).
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void   (no on-cast damage; only damage_zone)
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, applyTerrainDifficulty, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spike Growth',
  level: 2,
  school: 'transmutation',
  rangeFt: 150,
  aoeRadiusFt: 20,             // PHB p.277: 20-ft radius
  dieCount: 2,
  dieSides: 4,
  damageType: 'piercing' as const,
  concentration: true,
  castingTime: 'action',
  spikeGrowthDifficultTerrainV1Implemented: true,                 // PHB p.277: area becomes difficult terrain
  spikeGrowthMovementTriggerV1Implemented: false,                  // per-5-ft movement damage NOT modelled
  spikeGrowthUpcastV1Implemented: false,                           // (no upcast entry — placeholder)
  spikeGrowthConcentrationEnforcementV1Implemented: true,         // TG-002 DONE (Session 34)
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

// ---- Dice helper --------------------------------------------

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 * Used by the persistent start-of-turn damage tick.
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Spike Growth (a living enemy within
 * 150 ft, not already in a Spike Growth zone from this caster), or null
 * when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 150 ft — the
 *      persistent 2d4 piercing/turn is most valuable against a high-HP
 *      target that will survive multiple rounds.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Spike Growth' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 150 ft
 *
 * Note: Spike Growth IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Spike Growth')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 150) continue;

    // Skip if already in a Spike Growth zone from this caster.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Spike Growth'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Spike Growth:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Spike Growth.
 *  4. Apply a `damage_zone` effect on the target. The effect deals 2d4
 *     piercing at the start of each of the target's turns (the v1
 *     approximation of the canon "takes 2d4 piercing for every 5 ft moved"
 *     trigger — see header). The effect has sourceIsConcentration: true
 *     (removed when the caster's concentration breaks).
 *
 * v1 simplifications: NO on-cast damage (damage starts ticking at the
 * start of the target's NEXT turn); NO save (damage is automatic);
 * difficult terrain NOT modelled; per-5-ft movement damage NOT modelled
 * (start-of-turn tick instead); upcast N/A; concentration NOT enforced
 * (TG-002).
 *
 * @param caster  The casting Combatant (Druid/Ranger)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Spike Growth');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spike Growth around ${target.name}! (${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}/turn, no save, persistent)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // Session 79 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." Spike Growth has NO on-cast damage (PHB p.277: damage
  // is triggered by movement into/within the area, modelled in v1 as a
  // start-of-turn damage_zone tick). The persistent terrain_zone + damage_zone
  // ARE still applied to the target (so they can tick later if GoI expires);
  // the combat.ts tick loops re-check GoI on each per-turn tick using the
  // zones' sourceSlotLevel. The caster's own GoI does NOT block their own
  // spell (PHB p.245: "cast from outside the barrier").
  const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel, state.battlefield);
  if (goiBlocked) {
    emit(
      state, 'damage', caster.id,
      `${target.name} is protected by Globe of Invulnerability — Spike Growth persistent effect suppressed while GoI is active (will tick when GoI expires).`,
      target.id, 0,
    );
  }

  // Apply terrain_zone effect on the CASTER for difficult terrain.
  // PHB p.277: "The area becomes difficult terrain."
  // No terrainCondition/terrainSaveAbility — the terrain zone only marks cells
  // as difficult terrain; the save-or-condition mechanic does not apply.
  // The damage is handled separately by the damage_zone effect on the target.
  //
  // Session 79: sourceSlotLevel is set so the terrain_zone tick in combat.ts
  // can re-check GoI protection on each per-turn tick.
  const terrainEffect = applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Spike Growth',
    effectType: 'terrain_zone',
    sourceSlotLevel: slotLevel,
    payload: {
      terrainRadiusFt: 20,
      terrainCenterX: target.pos.x,
      terrainCenterY: target.pos.y,
      terrainCenterZ: target.pos.z,
      terrainDifficulty: true,
    },
    sourceIsConcentration: true,
  });
  applyTerrainDifficulty(state.battlefield, terrainEffect);

  // Apply damage_zone effect on the TARGET for persistent start-of-turn damage.
  // NO saveDC / saveAbility — the damage is automatic (no save per PHB p.277).
  //
  // ALWAYS applied (even to GoI-protected targets) so the spell can start
  // ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
  // damage_zone tick loop can re-check GoI protection on each per-turn
  // tick (PHB p.245: the spell continues to have no effect on GoI-
  // protected creatures for as long as GoI is active).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Spike Growth',
    effectType: 'damage_zone',
    sourceSlotLevel: slotLevel,
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is surrounded by spikes! (difficult terrain, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}/turn, no save)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Spike Growth — NO-OP in v1 because:
 *   - Spike Growth is a concentration spell; the damage_zone effect is
 *     removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
