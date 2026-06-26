// ============================================================
// Insect Plague — PHB p.254
//
// 5th-level conjuration, action, range 300 ft, concentration (10 min).
// Components: V, S, M (a few granules of sugar, some kernels of grain,
//             and a smear of fat).
//
// Effect (canon): Swarming, biting locusts fill a 20-foot-radius sphere
//                 centered on a point you choose within range. The sphere
//                 spreads around corners. The sphere remains for the
//                 duration, and its area is lightly obscured. The sphere's
//                 area is difficult terrain. When a creature enters the
//                 spell's area for the first time on a turn or starts its
//                 turn there, it must make a Constitution saving throw.
//                 The creature takes 4d10 piercing damage on a failed
//                 save, or half as much on a successful one.
//                 (Upcast: +1d10 per slot level above 5th.)
//
// v1 simplifications:
//   - Sphere placement: canon lets the caster place the sphere on any
//     point within 300 ft. v1 simplification: the sphere is centered on
//     the highest-threat enemy within 60 ft of the caster (battlefield
//     scale). Flag `insectPlagueCenterPointV1SimplifiedTo60Ft`.
//   - Sphere radius: canon 20 ft; v1 uses 20 ft (matches canon).
//   - Persistent damage: canon says "starts its turn there" → 4d10
//     piercing, CON save for half. v1 also applies 4d10 on cast (the
//     "enters the area for the first time on a turn" trigger).
//   - Lightly-obscured + difficult-terrain riders NOT modelled (no
//     terrain-modifier subsystem in v1). Flag
//     `insectPlagueObscureAndTerrainV1NotModelled`.
//   - Duration: canon 10 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: +1d10/slot-level NOT modelled.
//
// Spell module pattern (Session 31 architecture — multi-target center-point zone):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType, AbilityScore, Vec3 } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Insect Plague',
  level: 5,
  school: 'conjuration',
  rangeFt: 60,          // caster-to-center range (canon: 300 ft)
  aoeSizeFt: 20,        // 20-ft sphere radius (matches canon)
  dieCount: 4,
  dieSides: 10,
  damageType: 'piercing' as const as DamageType,
  concentration: true,
  saveAbility: 'con' as const as AbilityScore,
  castingTime: 'action',
  insectPlagueCenterPointV1SimplifiedTo60Ft: true,    // canon: any point within 300 ft; v1: highest-threat enemy within 60 ft
  insectPlagueObscureAndTerrainV1NotModelled: true,   // lightly-obscured + difficult-terrain riders
  insectPlagueUpcastV1Implemented: false,             // +1d10/slot-level not modelled
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
 * Returns candidate targets for Insect Plague (all living enemies within
 * 20 ft of the highest-threat enemy within 60 ft of the caster, not
 * already affected by this caster's Insect Plague), or null when the
 * spell should not be cast.
 *
 * Target priority:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of the
 *      caster — this enemy is the sphere's CENTER.
 *   2. Collect all living enemies within 20 ft of that center.
 *   3. Return those as targets.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Insect Plague' in their actions
 *   - Caster has at least one 5th-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 60 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Insect Plague')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

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

  // Step 2: collect all living enemies within 20 ft of the center.
  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFromCenter = chebyshev3D(center, c.pos) * 5;
    if (distFromCenter > metadata.aoeSizeFt) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Insect Plague'
    )) continue;

    targets.push(c);
  }

  if (targets.length === 0) return null;
  return targets;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Insect Plague:
 *  1. Consume a 5th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Insect Plague.
 *  4. For each target (enemy within 20 ft of the center):
 *     (a) Roll CON save vs caster's saveDC. On fail, 4d10 piercing; on
 *         success, half. Apply immediately (on-cast trigger).
 *     (b) Apply a `damage_zone` effect for persistent start-of-turn damage
 *         (4d10 piercing, CON save for half, sourceIsConcentration: true).
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Insect Plague');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 5) ?? 5;

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Insect Plague');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Insect Plague! A swarm of biting locusts fills the air (${targets.length} enem${targets.length !== 1 ? 'ies' : 'y'}: ${names}) — DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // Session 79 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
    // effect on them." The spell still fires (slot already consumed above).
    // For persistent damage zones, the damage_zone EFFECT is applied to ALL
    // targets in range (so it can tick later if GoI expires), but the ON-CAST
    // damage is skipped for GoI-protected targets. The caster's own GoI does
    // NOT block their own spell (PHB p.245: "cast from outside the barrier").
    const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel, state.battlefield);

    // 1. Immediate on-cast damage: CON save for half.
    //    Skipped if the target is GoI-protected (PHB p.245: "no effect on them").
    if (!goiBlocked) {
      const save = rollSaveReactable(state, caster, target, metadata.saveAbility, saveDC);
      const fullDmg = rollDamage();
      const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
      const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

      emit(
        state,
        save.success ? 'save_success' : 'save_fail',
        caster.id,
        `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Insect Plague (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
        target.id, save.roll,
      );
      emit(
        state, 'damage', caster.id,
        `${target.name} takes ${dealt} ${metadata.damageType} damage from Insect Plague (on cast)`,
        target.id, dealt,
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
      spellName: 'Insect Plague',
      effectType: 'damage_zone',
      sourceSlotLevel: slotLevel,
      payload: {
        dieCount: metadata.dieCount,
        dieSides: metadata.dieSides,
        damageType: metadata.damageType,
        saveDC,
        saveAbility: metadata.saveAbility,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is swarmed by biting locusts! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns, CON save for half)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
