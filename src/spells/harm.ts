// ============================================================
// Harm — PHB p.249
//
// 6th-level necromancy, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: You unleash a virulent disease on a creature that you can
//         see within range. The target must make a Constitution
//         saving throw. On a failed save, it takes 14d6 necrotic
//         damage and has its hit point maximum reduced for 1 hour
//         by an amount equal to the necrotic damage taken. Any
//         effect that removes a disease allows a creature's hit
//         point maximum to return to normal before that time passes.
//
// Upcast: +1d6 necrotic per slot level above 6th (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Single-target (PHB p.249: "a creature that you can see"). The
//     SPELL_DB entry marks Harm as isAoE:true, but that's a Session
//     19 bulk-data error — PHB p.249 is unambiguously single-target.
//     v1 implements it as single-target (mirror Catapult pattern).
//     Documented via `harmSingleTargetDespiteSpellDbFlag: true`.
//   - Max-HP-reduction (PHB p.249: "hit point maximum reduced for 1
//     hour by an amount equal to the necrotic damage taken"): NOT
//     modelled — v1 has no "maxHP-reduction" field on Combatant, and
//     no 1-hour-duration tracking. The damage is applied normally;
//     the max-HP-reduction rider is skipped. Documented via
//     `harmMaxHpReductionV1Simplified: true`. A future implementation
//     could add a `maxHpReduction` scratch field to Combatant (sum of
//     all sources, cleared on long rest / lesser restoration / heal).
//   - Disease-removal interaction (PHB p.249: "Any effect that removes
//     a disease allows a creature's hit point maximum to return to
//     normal"): NOT modelled — moot since max-HP-reduction is not
//     modelled.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 14d6
//     necrotic. Forward-compat TODO via `harmUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.249: instantaneous — the max-
//     HP-reduction is a 1-hour rider, not a concentration effect).
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with REAL CON
// save + 14d6 necrotic damage (the max-HP-reduction rider is
// simplified away). Removed from `_generic_registry.ts`; routed via
// `case 'harm':` in combat.ts and a planner branch in planner.ts.
// Mirrors the Catapult bespoke pattern (Session 22) but with CON
// save, 14d6 necrotic, 60-ft range, and L6 slot.
//
// Spell module pattern (single-target save — mirrors catapult.ts but
// with CON save, 14d6 necrotic, 60-ft range, L6 slot):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Harm',
  level: 6,
  school: 'necromancy',
  rangeFt: 60,                  // PHB p.249: 60 ft
  dieCount: 14,
  dieSides: 6,
  damageType: 'necrotic' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  harmSingleTargetDespiteSpellDbFlag: true,                          // PHB is single-target; SPELL_DB isAoE flag is a bulk-data error
  harmMaxHpReductionV1Simplified: true,                              // no maxHP-reduction field in v1
  harmUpcastV1Implemented: false,                                   // +1d6/slot-level NOT modelled
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
 * Returns the single best target for Harm (a living enemy within
 * 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Harm's
 *      14d6 (avg 49) necrotic is the highest single-target damage
 *      of the Session 23 batch, best spent against a high-HP target.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Harm' in their actions
 *   - Caster has at least one 6th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Harm is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Harm')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then lowest current HP (kill-shot bias),
  // then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Harm:
 *  1. Consume a 6th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's CON save vs the caster's saveDC.
 *  3. On fail: 14d6 necrotic. On success: half (floor).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: max-HP-reduction rider NOT modelled (no
 * maxHP-reduction field); disease-removal interaction NOT modelled;
 * upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Cleric / Druid / Sorcerer / Warlock / Wizard)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Harm');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Harm at ${target.name}! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Harm: ${target.name} is already down — virulent disease finds no host.`,
      target.id,
    );
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Harm (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Harm: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Harm — NO-OP because:
 *   - Harm is instantaneous (no persistent effect in v1 — the max-
 *     HP-reduction rider is simplified away).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
