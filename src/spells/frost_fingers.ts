// ============================================================
// Frost Fingers — XGE p.161 (also in EGtW p.156)
//
// 1st-level evocation, action, range Self (15-ft cone),
// NO concentration.
// Components: V, S.
//
// Effect: Freezing cold blasts out from your hands. Each creature in
//         a 15-foot cone originating from you must make a Constitution
//         saving throw. A creature takes 2d8 cold damage on a failed
//         save, or half as much on a successful one.
//
// Upcast: +1d8 cold per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Cone geometry: canon 15-ft cone from the caster's space (SAC v2.7
//     / PHB p.204). v1 aims the cone toward the nearest enemy within
//     15 ft and collects all living enemies inside that cone via
//     `inConeFt` (half-angle ≈ 26.57°). Forward-compat TODO via
//     `frostFingersConeGeometryV1Simplified: true`.
//   - Ally fire: excluded from shouldCast (AI never aims at allies).
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 2d8.
//     Forward-compat TODO via `frostFingersUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.161: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL CON save + 2d8
// cold cone AoE damage. Removed from `_generic_registry.ts`; routed
// via `case 'frostFingers':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Burning Hands bespoke pattern (Session 17)
// for the cone geometry, but uses the newer module structure
// (dieCount/dieSides metadata + rollDamage + cleanup +
// applyDamageWithTempHP, as established by Shatter / Lightning Bolt).
//
// Spell module pattern (cone AoE save — mirrors burning_hands.ts for
// the cone, shatter.ts for the damage loop):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Constants ----------------------------------------------

/** D&D 5e SAC cone half-angle in degrees (arctan(0.5) ≈ 26.57°). */
export const CONE_HALF_ANGLE_DEG = 26.57;

/** Range of Frost Fingers cone in feet. */
export const CONE_RANGE_FT = 15;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Frost Fingers',
  level: 1,
  school: 'evocation',
  rangeFt: CONE_RANGE_FT,        // XGE p.161: Self (15-ft cone)
  aoeRadiusFt: CONE_RANGE_FT,    // cone length (alias for AoE extent)
  dieCount: 2,
  dieSides: 8,
  damageType: 'cold' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  frostFingersConeGeometryV1Simplified: true,                        // chebyshev/nearest-aim cone approx
  frostFingersUpcastV1Implemented: false,                            // +1d8/slot-level NOT modelled
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
 * Returns the list of enemies that would be caught in a Frost Fingers
 * 15-ft cone aimed at the nearest enemy, or null when the spell should
 * not be cast.
 *
 * Target selection:
 *   1. Find the nearest living enemy within 15 ft (euclidean dist).
 *   2. Collect ALL living enemies inside the cone aimed at that nearest
 *      enemy (via inConeFt).
 *
 * Preconditions:
 *   - Caster has 'Frost Fingers' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 living enemy is within 15 ft (cone range)
 *
 * Note: Frost Fingers is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Frost Fingers')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find nearest enemy within cone range.
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

  // Collect all enemies in the cone aimed at the nearest enemy.
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
 * Execute Frost Fingers:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 2d8 cold. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 15-ft cone (nearest-aim + inConeFt approx);
 * ally fire excluded; upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard — XGE p.161)
 * @param targets Candidates from shouldCast (all enemies in the cone)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Frost Fingers');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 1) ?? 1;

  // Session 79: exclude targets protected by Globe of Invulnerability from
  // this AoE. PHB p.245: "the spell has no effect on them." The spell still
  // fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Frost Fingers! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${CONE_RANGE_FT}-ft cone) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    // Session 50 Task #29-follow-up-5c-3: Elemental Affinity (Draconic
    // Sorcerer 6) adds CHA mod to the cold damage if the caster's
    // ancestry is cold. Bonus is added once before save halving.
    const eaBonus = elementalAffinityBonus(caster, metadata.damageType);
    const fullDmg = rollDamage() + eaBonus;
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Frost Fingers (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Frost Fingers: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Frost Fingers — NO-OP because:
 *   - Frost Fingers is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
