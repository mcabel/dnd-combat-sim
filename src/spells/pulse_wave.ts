// ============================================================
// Pulse Wave — EGtW p.163
//
// 3rd-level evocation, action, range Self (30-ft cone),
// NO concentration.
// Components: V, S, M (a pulse of force).
//
// Effect: A powerful pulse of force emanates from you. Each creature in
//         a 30-foot cone originating from you must make a Constitution
//         saving throw. On a failed save, a creature takes 6d6 force
//         damage and is pushed 15 feet away from you. On a successful
//         save, the creature takes half as much damage and isn't pushed.
//
//         NOTE: EGtW p.163 also has a "pull" variant (casters can
//         choose push or pull). v1 simplifies to push-only.
//
// Upcast: +1d6 force per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Cone geometry: canon 30-ft cone from the caster's space (SAC v2.7
//     / PHB p.204). v1 aims the cone toward the nearest enemy within
//     30 ft and collects all living enemies inside that cone via
//     `inConeFt` (half-angle ≈ 26.57°). Mirrors the Frost Fingers /
//     Burning Hands cone pattern. Documented via
//     `pulseWaveConeGeometryV1Simplified: true`.
//   - Push 15 ft on failed save (EGtW p.163): NOT modelled — v1 has no
//     forced-movement subsystem. Documented via
//     `pulseWavePush15ftV1Simplified: true`.
//   - Pull variant (EGtW p.163: caster chooses push OR pull): NOT
//     modelled — v1 uses push-only (and even push is simplified away).
//     Documented via `pulseWavePullVariantV1Simplified: true`.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 6d6.
//     Forward-compat TODO via `pulseWaveUpcastV1Implemented: false`.
//   - NOT a concentration spell (EGtW p.163: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL CON save + 6d6
// force cone AoE damage. Removed from `_generic_registry.ts`; routed
// via `case 'pulseWave':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Frost Fingers bespoke pattern (Session 24)
// for the cone + damage loop, but with 6d6 force and a 30-ft cone.
//
// Spell module pattern (cone AoE save — mirrors frost_fingers.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Constants ----------------------------------------------

/** D&D 5e SAC cone half-angle in degrees (arctan(0.5) ≈ 26.57°). */
export const CONE_HALF_ANGLE_DEG = 26.57;

/** Range of Pulse Wave cone in feet. */
export const CONE_RANGE_FT = 30;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Pulse Wave',
  level: 3,
  school: 'evocation',
  rangeFt: CONE_RANGE_FT,        // EGtW p.163: Self (30-ft cone)
  aoeRadiusFt: CONE_RANGE_FT,    // cone length (alias for AoE extent)
  dieCount: 6,
  dieSides: 6,
  damageType: 'force' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  pulseWaveConeGeometryV1Simplified: true,                            // chebyshev/nearest-aim cone approx
  pulseWavePush15ftV1Simplified: true,                               // forced movement NOT modelled
  pulseWavePullVariantV1Simplified: true,                            // push-only (pull variant skipped)
  pulseWaveUpcastV1Implemented: false,                                // +1d6/slot-level NOT modelled
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

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies that would be caught in a Pulse Wave
 * 30-ft cone aimed at the nearest enemy, or null when the spell should
 * not be cast.
 *
 * Target selection:
 *   1. Find the nearest living enemy within 30 ft (euclidean dist).
 *   2. Collect ALL living enemies inside the cone aimed at that nearest
 *      enemy (via inConeFt).
 *
 * Preconditions:
 *   - Caster has 'Pulse Wave' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 living enemy is within 30 ft (cone range)
 *
 * Note: Pulse Wave is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Pulse Wave')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  let nearest: Combatant | null = null;
  let nearestDistFt = Infinity;
  for (const e of enemies) {
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt <= CONE_RANGE_FT && distFt < nearestDistFt) {
      nearest = e;
      nearestDistFt = distFt;
    }
  }

  if (!nearest) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inConeFt(caster.pos, nearest.pos, e.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) {
      targets.push(e);
    }
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Pulse Wave:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 6d6 force. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 30-ft cone (nearest-aim + inConeFt approx); push
 * 15 ft NOT modelled; pull variant NOT modelled; upcast NOT modelled;
 * NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard / Artificer — EGtW p.163)
 * @param targets Candidates from shouldCast (all enemies in the cone)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Pulse Wave');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 3);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Pulse Wave! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${CONE_RANGE_FT}-ft cone) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Pulse Wave (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Pulse Wave: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Pulse Wave — NO-OP because:
 *   - Pulse Wave is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
