// ============================================================
// Call Lightning — PHB p.220
//
// 3rd-level conjuration, action, range 120 ft, concentration (10 min).
// Components: V, S, M (a piece of fur and an amber, crystal, or glass rod).
//
// Effect (canon): A storm cloud appears in the shape of a cylinder that is
//                 10 feet tall with a 60-foot radius, centered on a point
//                 you can see within range directly above you. The spell
//                 fails if you can't see a point in the air where the storm
//                 cloud could appear. When you cast the spell, choose a
//                 point you can see within range. A bolt of lightning
//                 flashes down from the cloud to that point. Each creature
//                 within 5 feet of that point makes a Dexterity saving
//                 throw, taking 3d10 lightning damage on a failed save, or
//                 half as much on a successful one. On each of your turns
//                 thereafter, when you cast this spell, you can use your
//                 action to call down another bolt.
//                 (Upcast: +1d10 per slot level above 3rd.)
//
// v1 simplifications:
//   - Strike-point choice: canon lets the caster pick any point within
//     the cloud's 60-ft radius and re-pick each turn (action to call down
//     another bolt). v1 simplification: the strike point is FIXED at cast
//     time on the highest-threat enemy within 60 ft of the caster, and the
//     damage_zone effect ticks that same strike area each turn — flag
//     `callLightningStrikeChoiceV1Simplified`.
//   - Bolt radius: canon is 5 ft (each creature within 5 ft of the strike
//     point). v1 uses 10 ft (per task spec — battlefield grid scale
//     approximation). Flag `callLightningBoltRadiusV1SimplifiedTo10Ft`.
//   - DEX save: canon grants a DEX save for half. v1 has NO SAVE on the
//     bolt (per task spec — simplification). Flag
//     `callLightningDexSaveV1SimplifiedToNone`.
//   - Persistent damage: canon says "On each of your turns thereafter...
//     you can use your action to call down another bolt." v1 models this
//     as a damage_zone effect that ticks at the start of each affected
//     creature's turn (the engine's damage_zone tick). v1 also applies
//     3d10 on cast (the first bolt).
//   - Duration: canon 10 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: +1d10/slot-level NOT modelled.
//
// Spell module pattern (Session 31 architecture — multi-target center-point zone):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, filterGoIProtectedTargets, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Call Lightning',
  level: 3,
  school: 'conjuration',
  rangeFt: 60,           // caster-to-strike-point range (canon: 120 ft)
  aoeSizeFt: 10,         // bolt radius (canon: 5 ft; v1: 10 ft)
  dieCount: 3,
  dieSides: 10,
  damageType: 'lightning' as const as DamageType,
  concentration: true,
  castingTime: 'action',
  callLightningStrikeChoiceV1Simplified: true,        // strike point fixed at cast (canon: re-pick each turn)
  callLightningBoltRadiusV1SimplifiedTo10Ft: true,    // canon: 5 ft; v1: 10 ft
  callLightningDexSaveV1SimplifiedToNone: true,       // canon: DEX save for half; v1: no save
  callLightningMovingZoneV1Implemented: true,         // moving zone modelled (v1: automatic, no action cost)
  callLightningUpcastV1Implemented: false,            // +1d10/slot-level not modelled
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
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Call Lightning (all living enemies within
 * 10 ft of the highest-threat enemy within 60 ft of the caster, not
 * already affected by this caster's Call Lightning), or null when the
 * spell should not be cast.
 *
 * Target priority:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of the
 *      caster — this enemy is the STRIKE POINT (the bolt's center).
 *   2. Collect all living enemies within 10 ft of that strike point
 *      (the bolt's AoE).
 *   3. Return those as targets.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Call Lightning' in their actions
 *   - Caster has at least one 3rd-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 60 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Call Lightning')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  // Step 1: find the strike-point enemy (highest maxHP within 60 ft of caster).
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

  // Step 2: collect all living enemies within 10 ft of the strike point.
  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFromCenter = chebyshev3D(center, c.pos) * 5;
    if (distFromCenter > metadata.aoeSizeFt) continue;

    // Skip if already affected by this caster's Call Lightning (re-cast wasteful)
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Call Lightning'
    )) continue;

    targets.push(c);
  }

  if (targets.length === 0) return null;
  return targets;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Call Lightning:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Call Lightning.
 *  4. For each target (enemy within 10 ft of the strike point):
 *     (a) Roll 3d10 lightning, apply immediately (the first bolt — no save
 *         per v1 simplification).
 *     (b) Apply a `damage_zone` effect for persistent start-of-turn damage
 *         (3d10 lightning, no save, sourceIsConcentration: true).
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);
  const slotLevel = 3;

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Call Lightning');

  const names = targets.map(t => t.name).join(', ');

  // Session 78 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above).
  // For persistent damage zones, the damage_zone EFFECT is applied to ALL
  // targets in range (so it can tick later if GoI expires), but the ON-CAST
  // damage is skipped for GoI-protected targets. The combat.ts damage_zone
  // tick loop re-checks GoI on each per-turn tick using sourceSlotLevel.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Call Lightning! A storm cloud gathers, and a bolt strikes (${effectiveTargets.length} enem${effectiveTargets.length !== 1 ? 'ies' : 'y'} in range: ${names}) — ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, no save${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // Session 78: check GoI protection per-target. The caster's own GoI does
    // NOT block their own spell (PHB p.245: "cast from outside the barrier").
    const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel);

    // 1. Immediate on-cast damage (3d10 lightning, no save).
    //    Skipped if the target is GoI-protected (PHB p.245: "no effect on them").
    // Session 50 Task #29-follow-up-5c-3: Elemental Affinity (Draconic
    // Sorcerer 6) adds CHA mod to the lightning damage if the caster's
    // ancestry is lightning. No save → no halving. The damage_zone tick
    // (start-of-turn bolt) does NOT get EA — the tick handler has no
    // caster context.
    if (!goiBlocked) {
      const eaBonus = elementalAffinityBonus(caster, metadata.damageType);
      const immediateDmg = rollDamage() + eaBonus;
      const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
      emit(
        state, 'damage', caster.id,
        `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Call Lightning bolt (on cast: ${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
        target.id, dealtImmediate,
      );
    } else {
      emit(
        state, 'damage', caster.id,
        `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`,
        target.id, 0,
      );
    }

    // 2. Apply damage_zone effect for persistent start-of-turn damage.
    //    ALWAYS applied (even to GoI-protected targets) so the spell can start
    //    ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
    //    damage_zone tick loop can re-check GoI protection on each per-turn
    //    tick (PHB p.245: the spell continues to have no effect on GoI-
    //    protected creatures for as long as GoI is active).
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Call Lightning',
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
      `${target.name} is in the storm's strike zone! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns)`,
      target.id,
    );
  }

  // Set _movingZone on the caster so the bolt can move at the start of
  // each of the caster's turns (v1: automatic movement toward highest-threat
  // enemy, no action cost — canon requires an action to call down another bolt).
  // Use the first target's position as the initial center (the strike point).
  const centerTarget = effectiveTargets.find(t => !t.isDead && !t.isUnconscious) ?? targets[0];
  caster._movingZone = {
    spellName: 'Call Lightning',
    centerX: centerTarget.pos.x,
    centerY: centerTarget.pos.y,
    centerZ: centerTarget.pos.z,
    radiusFt: 10,    // 10-ft bolt radius (v1 simplification; canon: 5 ft)
    movePerTurn: 60,  // 60 ft per turn (PHB p.220: strike any point within 60 ft)
  };
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
