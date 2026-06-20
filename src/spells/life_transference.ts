// ============================================================
// Life Transference — XGE p.160
//
// 3rd-level necromancy, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: You sacrifice some of your health to mend another creature's
//         injuries. Take 4d8 necrotic damage to yourself. One creature
//         of your choice within range regains a number of hit points
//         equal to twice the necrotic damage you take.
//
//         NOTE: XGE p.160 wording — the caster takes 4d8 necrotic
//         damage (no save), and a target ally is healed for 2× that
//         amount. The plan spec paraphrases this as "CON save 4d8
//         necrotic + heal caster 2× damage" — that is INCORRECT per
//         canon. v1 follows CANON (caster self-damages, ally healed),
//         not the plan's mis-paraphrase. See simplifications.
//
// Upcast: +1d8 necrotic (self) per slot level above 3rd (not modelled).
//
// v1 simplifications:
//   - Canon-faithful: caster takes 4d8 necrotic (no save, no attack),
//     target ally is healed for 2× the necrotic taken. This is the
//     FIRST spell in v1 with a "self-damage → ally-heal" transfer.
//     Documented via `lifeTransferenceCanonSelfDamageAllyHealV1: true`.
//   - Plan-spec deviation: the plan paraphrases this as a CON-save
//     damage spell that heals the CASTER for 2× damage dealt. v1
//     follows CANON (XGE p.160) instead — self-damage + ally-heal.
//     Documented via `lifeTransferencePlanDeviationNoted: true`.
//   - Target selection: v1 picks the lowest-current-HP ally within 60 ft
//     (the most efficient heal target). If no injured ally is in range,
//     shouldCast returns null (don't waste the slot + self-damage).
//     Documented via `lifeTransferenceTargetsLowestHpAllyV1: true`.
//   - Self-damage: v1 applies 4d8 necrotic to the CASTER via
//     applyDamageWithTempHP (handles the caster's own resistances / temp
//     HP). The self-damage CAN drop the caster to 0 (v1 does NOT model
//     the "you can't reduce yourself below 1 HP" clause some tables use;
//     XGE p.160 has no such clause — the caster takes the full damage).
//     Documented via `lifeTransferenceSelfDamageCanDropCasterV1: true`.
//   - Heal amount: 2× the necrotic damage ACTUALLY dealt to the caster
//     (after temp HP / resistance), not 2× the raw roll. This matches
//     XGE p.160's "twice the necrotic damage you take" (take = actually
//     suffered). Documented via `lifeTransferenceHealBasedOnActualDamageV1: true`.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 4d8.
//     Forward-compat TODO via `lifeTransferenceUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.160: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL self-damage +
// ally-heal. Removed from `_generic_registry.ts`; routed via
// `case 'lifeTransference':` in combat.ts and a planner branch in
// planner.ts. This is a NEW pattern (self-damage → ally-heal transfer)
// — shouldCast returns a single ALLY Combatant (not an enemy), and
// execute damages the caster + heals the ally.
//
// Spell module pattern (self-damage + ally-heal — NEW pattern):
//   shouldCast(caster, bf) → Combatant | null   (returns an ALLY)
//   execute(caster, allyTarget, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, applyHeal } from '../engine/utils';
import { chebyshev3D, livingAlliesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Life Transference',
  level: 3,
  school: 'necromancy',
  rangeFt: 60,                   // XGE p.160: 60 ft
  dieCount: 4,
  dieSides: 8,
  damageType: 'necrotic' as const,
  healMultiplier: 2,             // XGE p.160: ally heals 2× the necrotic taken
  concentration: false,
  saveAbility: null,             // XGE p.160: NO save (canon)
  castingTime: 'action',
  lifeTransferenceCanonSelfDamageAllyHealV1: true,                   // canon: self-damage + ally-heal
  lifeTransferencePlanDeviationNoted: true,                          // plan mis-paraphrased; v1 follows canon
  lifeTransferenceTargetsLowestHpAllyV1: true,                       // picks lowest-current-HP ally
  lifeTransferenceSelfDamageCanDropCasterV1: true,                   // no "min 1 HP" clause
  lifeTransferenceHealBasedOnActualDamageV1: true,                   // heal = 2× actual necrotic suffered
  lifeTransferenceUpcastV1Implemented: false,                        // +1d8/slot-level NOT modelled
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

/** Roll `metadata.dieCount`d`metadata.dieSides` necrotic (self-damage). */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best ALLY target for Life Transference, or null
 * when the spell should not be cast.
 *
 * Target priority (ALLY selection — this is a HEAL spell):
 *   1. Lowest-current-HP living ally within 60 ft (most efficient heal
 *      target — the ally who needs it most). Excludes the caster (the
 *      caster is the source of the self-damage, not a valid heal
 *      target — XGE p.160: "another creature").
 *   2. Tie-break: highest maxHP (more total HP value restored).
 *
 * Preconditions:
 *   - Caster has 'Life Transference' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 living INJURED ally (currentHP < maxHP) within 60 ft
 *     — v1 won't waste the slot + self-damage on a full-HP ally
 *
 * Note: Life Transference is NOT concentration. The planner should NOT
 * gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Life Transference')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const allies = livingAlliesOf(caster, bf);
  const candidates: Array<{ c: Combatant; curHP: number; maxHP: number; dist: number }> = [];

  for (const a of allies) {
    const distFt = chebyshev3D(caster.pos, a.pos) * 5;
    if (distFt > 60) continue;
    // Only heal injured allies (currentHP < maxHP) — don't waste the slot.
    if (a.currentHP >= a.maxHP) continue;
    candidates.push({ c: a, curHP: a.currentHP, maxHP: a.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: lowest current HP first (most injured), then highest maxHP
  // (more total value), then closest.
  candidates.sort((a, b) => {
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    if (a.maxHP !== b.maxHP) return b.maxHP - a.maxHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Life Transference (canon: self-damage + ally-heal):
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll 4d8 necrotic (self-damage).
 *  3. Apply the necrotic to the CASTER via applyDamageWithTempHP
 *     (handles caster's own resistances / temp HP). The self-damage CAN
 *     drop the caster to 0 (no "min 1 HP" clause per XGE p.160).
 *  4. Heal the ally for 2× the ACTUAL necrotic damage taken (after temp
 *     HP / resistance), via applyHeal (handles revive-from-0).
 *  5. Log the self-damage + heal.
 *
 * v1 simplifications: canon self-damage/ally-heal (plan's mis-paraphrase
 * rejected); targets lowest-HP injured ally; self-damage can drop caster
 * to 0; heal = 2× actual damage; upcast NOT modelled; NOT concentration.
 *
 * @param caster     The casting Combatant (Cleric / Wizard — XGE p.160)
 * @param allyTarget The ALLY Combatant to heal (must be within 60 ft — shouldCast enforces)
 * @param state      Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  allyTarget: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Life Transference! (self: ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} (no save); ${allyTarget.name} heals ${metadata.healMultiplier}× the necrotic taken)`,
    allyTarget.id,
  );

  if (allyTarget.isDead || allyTarget.isUnconscious) {
    // Defensive — shouldCast filters unconscious allies, but re-check.
    emit(
      state, 'action', caster.id,
      `Life Transference: ${allyTarget.name} is down — the transfer fizzles (slot consumed, no self-damage).`,
      allyTarget.id,
    );
    return;
  }

  // 1. Self-damage: 4d8 necrotic to the caster.
  const rawNecrotic = rollDamage();
  const selfDamage = applyDamageWithTempHP(caster, rawNecrotic, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Life Transference: ${caster.name} takes ${selfDamage} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${rawNecrotic}${selfDamage < rawNecrotic ? ', reduced by temp HP/resistance' : ''}) — sacrifice!`,
    caster.id, selfDamage,
  );

  // 2. Heal the ally for 2× the ACTUAL necrotic taken.
  const healAmount = selfDamage * metadata.healMultiplier;
  const healed = applyHeal(allyTarget, healAmount);
  emit(
    state, 'heal', caster.id,
    `Life Transference: ${allyTarget.name} regains ${healed} HP (2× ${selfDamage} necrotic = ${healAmount} base)`,
    allyTarget.id, healed,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Life Transference — NO-OP because:
 *   - Life Transference is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
