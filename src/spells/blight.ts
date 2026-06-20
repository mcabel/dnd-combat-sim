// ============================================================
// Blight — PHB p.219
//
// 4th-level necromancy, action, range 30 ft, NO concentration.
// Components: V, S, M (a drop of water).
//
// Effect: Necromantic energy washes over a creature of your choice
//         that you can see within range, draining moisture and vitality
//         from it. The target must make a Constitution saving throw.
//         The target takes 8d8 necrotic damage on a failed save, or
//         half as much on a successful one. This spell has no effect
//         on undead or constructs.
//
//         If you target a plant creature or a magical plant, it makes
//         the save with disadvantage, and the spell deals maximum
//         damage. If you target a nonmagical plant that isn't a
//         creature, such as a tree or bush, it doesn't make a save;
//         it simply withers and dies.
//
// Upcast: +1d8 necrotic per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 30 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Single-target (PHB p.219: "a creature of your choice"). The
//     SPELL_DB entry marks Blight as isAoE:true, but that's a Session
//     19 bulk-data error — PHB p.219 is unambiguously single-target.
//     v1 implements it as single-target (mirror Catapult pattern).
//     Documented via `blightSingleTargetDespiteSpellDbFlag: true`.
//   - Undead/construct immunity (PHB p.219: "no effect on undead or
//     constructs"): NOT modelled — v1 has no creature-type tag.
//     Documented via `blightUndeadConstructImmunityV1Simplified: true`.
//   - Plant-creature disadvantage + max damage (PHB p.219): NOT
//     modelled — v1 has no creature-type tag. Documented via
//     `blightPlantDisadvantageV1Simplified: true`.
//   - Nonmagical-plant wither (PHB p.219: "it simply withers and
//     dies"): NOT modelled — v1 has no object/plant subsystem.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 8d8
//     necrotic. Forward-compat TODO via `blightUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.219: instantaneous).
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with REAL CON
// save + 8d8 necrotic damage. Removed from `_generic_registry.ts`;
// routed via `case 'blight':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Catapult bespoke pattern (Session 22) but
// with CON save instead of DEX, 8d8 necrotic instead of 3d8
// bludgeoning, range 30 ft instead of 60 ft, and 4th-level slot
// instead of 1st.
//
// Spell module pattern (single-target save — mirrors catapult.ts but
// with CON save, 8d8 necrotic, 30-ft range, L4 slot):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Blight',
  level: 4,
  school: 'necromancy',
  rangeFt: 30,                  // PHB p.219: 30 ft
  dieCount: 8,
  dieSides: 8,
  damageType: 'necrotic' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  blightSingleTargetDespiteSpellDbFlag: true,                       // PHB is single-target; SPELL_DB isAoE flag is a bulk-data error
  blightUndeadConstructImmunityV1Simplified: true,                  // no creature-type tag in v1
  blightPlantDisadvantageV1Simplified: true,                        // no creature-type tag in v1
  blightUpcastV1Implemented: false,                                 // +1d8/slot-level NOT modelled
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
 * Returns the single best target for Blight (a living enemy within
 * 30 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 30 ft — Blight's
 *      8d8 (avg 36) necrotic is best spent against a high-HP target.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Blight' in their actions
 *   - Caster has at least one 4th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 30 ft
 *
 * Note: Blight is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Blight')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 30) continue;
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
 * Execute Blight:
 *  1. Consume a 4th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's CON save vs the caster's saveDC.
 *  3. On fail: 8d8 necrotic. On success: half (floor).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: undead/construct immunity NOT applied (no
 * creature-type tag); plant-creature disadvantage/max-damage NOT
 * applied; nonmagical-plant wither NOT modelled; upcast NOT modelled;
 * NOT concentration.
 *
 * @param caster  The casting Combatant (Druid / Sorcerer / Warlock / Wizard)
 * @param target  The target Combatant (must be within 30 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Blight');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Blight at ${target.name}! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Blight: ${target.name} is already down — necromantic energy dissipates.`,
      target.id,
    );
    return;
  }

  const save = rollSave(target, 'con', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Blight (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Blight: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Blight — NO-OP because:
 *   - Blight is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
