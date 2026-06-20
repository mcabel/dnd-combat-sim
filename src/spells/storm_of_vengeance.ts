// ============================================================
// Storm of Vengeance — PHB p.279
//
// 9th-level conjuration, action, range 60 ft (battlefield scale; canon: sight),
// concentration (1 min).
// Components: V, S, M (a polished ebony fly).
//
// Effect (canon): A churning storm cloud forms, centered on a point you
//                 can see and spreading to a radius of 360 feet. Lightning
//                 flashes in the area, thunder booms, and strong winds
//                 roar. Each creature under the cloud at the start of its
//                 turn makes a Constitution saving throw. The creature
//                 takes 2d6 thunder damage and 6d6 lightning damage on a
//                 failed save, or half as much on a successful one. The
//                 storm's area is difficult terrain. Each round on your
//                 turn, the storm produces a different effect (acid rain,
//                 hailstones, blinding rain, deafening wind gusts) — the
//                 other effects have saves but are simplified out of v1.
//                 (Upcast: see source — not modelled in v1.)
//
// v1 simplifications:
//   - Cloud radius: canon 360-ft radius; v1 uses 60 ft (battlefield scale —
//     360 ft covers the entire battlefield, making targeting trivial; v1
//     uses 60 ft to preserve meaningful placement choice). Flag
//     `stormOfVengeanceRadiusV1SimplifiedTo60Ft`.
//   - Center point: canon lets the caster pick any visible point. v1
//     simplification: the cloud is centered on the highest-threat enemy
//     within 60 ft of the caster — flag
//     `stormOfVengeanceCenterPointV1SimplifiedToHighestThreat`.
//   - DUAL DAMAGE: canon deals 2d6 thunder + 6d6 lightning per turn. v1
//     models BOTH as start-of-turn ticks via TWO damage_zone effects per
//     target:
//       (a) { dieCount: 2, dieSides: 6, damageType: 'thunder' }
//       (b) { dieCount: 6, dieSides: 6, damageType: 'lightning' }
//     The engine's damage_zone tick loops all zones on each affected
//     creature independently (backward-compatible — no engine change).
//   - NO save: canon grants a CON save for half on both damage types.
//     v1 has NO SAVE (per task spec — simplification). Flag
//     `stormOfVengeanceConSaveV1SimplifiedToNone`.
//   - Other effects (acid rain, hailstones, blinding rain, deafening
//     wind gusts) NOT modelled (no per-round-effect subsystem). Flag
//     `stormOfVengeanceOtherEffectsV1Simplified`.
//   - Difficult-terrain rider NOT modelled (no terrain-modifier subsystem).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: NOT modelled.
//
// Spell module pattern (Session 31 architecture — multi-target center-point zone):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Storm of Vengeance',
  level: 9,
  school: 'conjuration',
  rangeFt: 60,          // caster-to-center range (battlefield scale)
  aoeSizeFt: 60,        // cloud radius (canon: 360 ft; v1: 60 ft)
  thunderDieCount: 2,
  thunderDieSides: 6,
  lightningDieCount: 6,
  lightningDieSides: 6,
  thunderDamageType: 'thunder' as const as DamageType,
  lightningDamageType: 'lightning' as const as DamageType,
  concentration: true,
  castingTime: 'action',
  stormOfVengeanceRadiusV1SimplifiedTo60Ft: true,         // canon: 360-ft radius; v1: 60-ft (battlefield scale)
  stormOfVengeanceCenterPointV1SimplifiedToHighestThreat: true,
  stormOfVengeanceConSaveV1SimplifiedToNone: true,        // canon: CON save for half; v1: no save
  stormOfVengeanceOtherEffectsV1Simplified: true,         // acid rain + hail + blind + deafen NOT modelled
  stormOfVengeanceUpcastV1Implemented: false,             // upcast NOT modelled
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

/** Roll `count`d`sides` and return the total. */
export function rollNDice(count: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(sides);
  return total;
}

/** Roll the thunder-damage portion (2d6). */
export function rollThunderDamage(): number {
  return rollNDice(metadata.thunderDieCount, metadata.thunderDieSides);
}

/** Roll the lightning-damage portion (6d6). */
export function rollLightningDamage(): number {
  return rollNDice(metadata.lightningDieCount, metadata.lightningDieSides);
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Storm of Vengeance (all living enemies
 * within 60 ft of the highest-threat enemy within 60 ft of the caster, not
 * already affected by this caster's Storm of Vengeance), or null when the
 * spell should not be cast.
 *
 * Target priority:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of the
 *      caster — this enemy is the storm cloud's CENTER.
 *   2. Collect all living enemies within 60 ft of that center.
 *   3. Return those as targets.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Storm of Vengeance' in their actions
 *   - Caster has at least one 9th-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 60 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Storm of Vengeance')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  // Step 1: find the center enemy (highest maxHP within 60 ft of caster).
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  const center: Vec3 = candidates[0].c.pos;

  // Step 2: collect all living enemies within 60 ft of the center.
  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFromCenter = chebyshev3D(center, c.pos) * 5;
    if (distFromCenter > metadata.aoeSizeFt) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Storm of Vengeance'
    )) continue;

    targets.push(c);
  }

  if (targets.length === 0) return null;
  return targets;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Storm of Vengeance:
 *  1. Consume a 9th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Storm of Vengeance.
 *  4. For each target (enemy within 60 ft of the center):
 *     (a) Roll 2d6 thunder + 6d6 lightning, apply both immediately (on-cast
 *         trigger, no save per v1 simplification).
 *     (b) Apply TWO `damage_zone` effects for persistent start-of-turn
 *         damage (one for thunder, one for lightning — both
 *         sourceIsConcentration: true). The engine's damage_zone tick loops
 *         all zones on each affected creature independently.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 9);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Storm of Vengeance');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Storm of Vengeance! A churning storm cloud forms (${targets.length} enem${targets.length !== 1 ? 'ies' : 'y'}: ${names}) — ${metadata.thunderDieCount}d${metadata.thunderDieSides} ${metadata.thunderDamageType} + ${metadata.lightningDieCount}d${metadata.lightningDieSides} ${metadata.lightningDamageType} per turn, no save`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // 1. Immediate on-cast damage: 2d6 thunder + 6d6 lightning (no save).
    const thunderDmg = rollThunderDamage();
    const lightningDmg = rollLightningDamage();
    const dealtThunder = applyDamageWithTempHP(target, thunderDmg, metadata.thunderDamageType);
    const dealtLightning = applyDamageWithTempHP(target, lightningDmg, metadata.lightningDamageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealtThunder} ${metadata.thunderDamageType} + ${dealtLightning} ${metadata.lightningDamageType} damage from Storm of Vengeance (on cast: ${metadata.thunderDieCount}d${metadata.thunderDieSides}=${thunderDmg} + ${metadata.lightningDieCount}d${metadata.lightningDieSides}=${lightningDmg})`,
      target.id, dealtThunder + dealtLightning,
    );

    // 2. Apply TWO damage_zone effects for persistent start-of-turn damage.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Storm of Vengeance',
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.thunderDieCount,
        dieSides: metadata.thunderDieSides,
        damageType: metadata.thunderDamageType,
      },
      sourceIsConcentration: true,
    });
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Storm of Vengeance',
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.lightningDieCount,
        dieSides: metadata.lightningDieSides,
        damageType: metadata.lightningDamageType,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is caught in the storm! (will take ${metadata.thunderDieCount}d${metadata.thunderDieSides} ${metadata.thunderDamageType} + ${metadata.lightningDieCount}d${metadata.lightningDieSides} ${metadata.lightningDamageType} at the start of each of its turns)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
