// ============================================================
// Spray of Cards — BMT p.50 (The Book of Many Things)
//
// 2nd-level conjuration, action, range Self (15-ft cone),
// NO concentration.
// Components: V, S, M (a deck of cards).
//
// Effect: You spray a 15-foot cone of spectral cards. Each creature in
//         that area must make a Dexterity saving throw. On a failed
//         save, a creature takes 2d10 slashing damage and is blinded
//         until the end of your next turn. On a successful save, the
//         creature takes half as much damage and isn't blinded.
//
//         NOTE: the BMT source lists the damage type as force in some
//         printings; v1 follows the MEGABATCH-MIGRATION-PLAN spec
//         (2d10 slashing). See simplifications.
//
// Upcast: +1d10 slashing per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Cone geometry: canon 15-ft cone from the caster's space (SAC v2.7
//     / PHB p.204). v1 aims the cone toward the nearest enemy within
//     15 ft and collects all living enemies inside that cone via
//     `inConeFt` (half-angle ≈ 26.57°). Mirrors the Frost Fingers /
//     Burning Hands cone pattern. Documented via
//     `sprayOfCardsConeGeometryV1Simplified: true`.
//   - Damage type: BMT p.50 / SPELL_DB lists "force" in some entries;
//     the MEGABATCH-MIGRATION-PLAN spec says "slashing". v1 follows the
//     plan spec (slashing). Documented via
//     `sprayOfCardsDamageTypeSlashingV1PerPlan: true`.
//   - Blinded on failed save (BMT p.50: "blinded until the end of your
//     next turn"): v1 applies the blinded condition via condition_apply
//     (mirror Sunburst's blinded pattern). The end-of-next-turn expiry
//     is NOT tracked — the condition persists for the v1 combat (same
//     gap as Sunburst / Blindness/Deafness). Documented via
//     `sprayOfCardsBlindedDurationV1Simplified: true`.
//   - Ally fire: excluded from shouldCast (AI never aims at allies).
//   - Upcast: +1d10/slot-level NOT modelled — v1 always rolls 2d10.
//     Forward-compat TODO via `sprayOfCardsUpcastV1Implemented: false`.
//   - NOT a concentration spell (BMT p.50: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL DEX save + 2d10
// slashing cone AoE damage + blinded on failed save. Removed from
// `_generic_registry.ts`; routed via `case 'sprayOfCards':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Frost
// Fingers bespoke pattern (Session 24) for the cone + damage loop,
// plus the Sunburst bespoke pattern (Session 23) for the blinded
// condition_apply on failed save.
//
// Spell module pattern (cone AoE save + condition — mirrors
// frost_fingers.ts + sunburst.ts condition_apply):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous; blinded persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

// ---- Constants ----------------------------------------------

/** D&D 5e SAC cone half-angle in degrees (arctan(0.5) ≈ 26.57°). */
export const CONE_HALF_ANGLE_DEG = 26.57;

/** Range of Spray of Cards cone in feet. */
export const CONE_RANGE_FT = 15;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spray of Cards',
  level: 2,
  school: 'conjuration',
  rangeFt: CONE_RANGE_FT,        // BMT p.50: Self (15-ft cone)
  aoeRadiusFt: CONE_RANGE_FT,    // cone length (alias for AoE extent)
  dieCount: 2,
  dieSides: 10,
  damageType: 'slashing' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  sprayOfCardsConeGeometryV1Simplified: true,                        // chebyshev/nearest-aim cone approx
  sprayOfCardsDamageTypeSlashingV1PerPlan: true,                    // plan says slashing (some sources say force)
  sprayOfCardsBlindedDurationV1Simplified: true,                    // end-of-next-turn expiry NOT tracked
  sprayOfCardsUpcastV1Implemented: false,                            // +1d10/slot-level NOT modelled
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
 * Returns the list of enemies that would be caught in a Spray of Cards
 * 15-ft cone aimed at the nearest enemy, or null when the spell should
 * not be cast.
 *
 * Target selection:
 *   1. Find the nearest living enemy within 15 ft (euclidean dist).
 *   2. Collect ALL living enemies inside the cone aimed at that nearest
 *      enemy (via inConeFt).
 *
 * Preconditions:
 *   - Caster has 'Spray of Cards' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 living enemy is within 15 ft (cone range)
 *
 * Note: Spray of Cards is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Spray of Cards')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

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
 * Execute Spray of Cards:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's DEX save vs the caster's saveDC.
 *     b. On fail: 2d10 slashing + blinded (condition_apply).
 *     c. On success: half damage (floor), NO blindness.
 *     d. Apply damage via applyDamageWithTempHP (handles resistances /
 *        temp HP / Warding Bond redirect).
 *     e. On failed save, apply blinded via applySpellEffect (mirror
 *        Sunburst's blinded pattern — NOT concentration; persists for
 *        the v1 combat duration).
 *     f. Log each save result + damage + condition.
 *
 * v1 simplifications: 15-ft cone (nearest-aim + inConeFt approx);
 * damage type slashing per plan (some sources say force); blinded
 * duration NOT tracked (persists for combat); ally fire excluded;
 * upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Warlock / Wizard — BMT p.50)
 * @param targets Candidates from shouldCast (all enemies in the cone)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Spray of Cards');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spray of Cards! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${CONE_RANGE_FT}-ft cone + blinded on fail) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Spray of Cards (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + BLINDED'}`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Spray of Cards: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    // On failed save: apply blinded condition (mirror Sunburst's blinded).
    // NOT concentration — sourceIsConcentration: false. The condition
    // persists for the entire combat in v1 (end-of-next-turn NOT tracked).
    if (!save.success) {
      if (!target.conditions.has('blinded')) {
        applySpellEffect(target, {
          casterId: caster.id,
          spellName: 'Spray of Cards',
          effectType: 'condition_apply',
          payload: { condition: 'blinded' },
          sourceIsConcentration: false,   // BMT p.50: NOT concentration
        });
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is BLINDED by the spectral cards! (disadvantage on attacks, advantage on attacks vs them)`,
          target.id,
        );
      } else {
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is already blinded — Spray of Cards's blindness has no additional effect.`,
          target.id,
        );
      }
    }
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Spray of Cards — NO-OP in v1 because:
 *   - Spray of Cards is NOT a concentration spell; the blinded condition
 *     persists for the v1 combat duration (end-of-next-turn NOT tracked).
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; condition persists for v1 combat.
}
