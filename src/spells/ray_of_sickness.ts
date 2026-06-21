// ============================================================
// Ray of Sickness — PHB p.271
//
// 1st-level necromancy, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: A ray of sickening greenish energy lashes out toward a
//         creature within range. Make a ranged spell attack against
//         the target. On a hit, the target takes 2d8 poison damage
//         and must make a Constitution saving throw or be poisoned
//         until the end of your next turn.
//
//         NOTE: PHB p.271 wording: "On a hit, the target takes 2d8
//         poison damage and ... is poisoned." The poisoned condition's
//         save is rolled into the hit (no separate save in v1 — see
//         simplifications).
//
// Upcast: +1d8 poison per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Poisoned save: PHB p.271 has the target make a CON save AFTER
//     the hit to avoid being poisoned. v1 folds this into the attack:
//     on a HIT, the target is poisoned unconditionally (no second
//     save). This is a conservative simplification (slightly stronger
//     than canon — canon allows a save to negate the poison). The
//     poison damage itself is still applied on hit. Documented via
//     `rayOfSicknessPoisonSaveV1Simplified: true`.
//   - Poisoned duration: PHB p.271 "until the end of your next turn".
//     v1 applies poisoned via condition_apply and does NOT track the
//     end-of-turn expiry (the condition persists for the v1 combat,
//     matching the Blindness/Deafness + Sunburst simplifications).
//     Documented via `rayOfSicknessPoisonDurationV1Simplified: true`.
//   - Hit bonus: v1 falls back to the action's hitBonus (parser
//     populates it for spell attacks). If null, v1 falls back to
//     abilityMod(caster.cha) (Sorcerer primary — Ray of Sickness is a
//     Sorcerer spell, PHB p.271). Mirrors the Scorching Ray / Chromatic
//     Orb fallback pattern but with CHA.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 2d8.
//     Forward-compat TODO via `rayOfSicknessUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.271: instantaneous — the poison
//     rider is a short non-concentration effect).
//   - Crit DOES double the dice (standard PHB p.196 crit rule for
//     spell attacks — same as Chromatic Orb / Inflict Wounds).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL ranged spell
// attack + 2d8 poison damage + poisoned on hit. Removed from
// `_generic_registry.ts`; routed via `case 'rayOfSickness':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Chromatic
// Orb bespoke pattern (Session 21) for the attack + damage, plus the
// Sunburst bespoke pattern (Session 23) for the condition_apply on a
// hit/fail.
//
// Spell module pattern (single-target ranged spell attack + condition
// rider — mirrors chromatic_orb.ts + sunburst.ts condition_apply):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous; poison persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Ray of Sickness',
  level: 1,
  school: 'necromancy',
  rangeFt: 60,                   // PHB p.271: 60 ft
  dieCount: 2,
  dieSides: 8,
  damageType: 'poison' as const,
  concentration: false,
  castingTime: 'action',
  rayOfSicknessPoisonSaveV1Simplified: true,                         // poisoned save folded into the hit
  rayOfSicknessPoisonDurationV1Simplified: true,                    // end-of-next-turn expiry NOT tracked
  rayOfSicknessUpcastV1Implemented: false,                           // +1d8/slot-level NOT modelled
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
 * Crit doubles the dice (PHB p.196: "roll the dice twice").
 */
export function rollDamage(isCrit = false): number {
  let total = 0;
  const rolls = isCrit ? metadata.dieCount * 2 : metadata.dieCount;
  for (let i = 0; i < rolls; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Ray of Sickness (a living enemy
 * within 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Ray of
 *      Sickness's 2d8 (avg 9) poison + poisoned rider is best spent
 *      against a high-HP target that will suffer the disadvantage on
 *      its own attacks for multiple rounds.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Ray of Sickness' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Ray of Sickness is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Ray of Sickness')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

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
 * Execute Ray of Sickness:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll a ranged spell attack vs the target's AC.
 *  3. On hit: 2d8 poison damage + poisoned condition (condition_apply).
 *     On crit: 4d8 poison (dice doubled) + poisoned.
 *  4. Apply damage via applyDamageWithTempHP (handles resistances / temp
 *     HP / Warding Bond redirect).
 *  5. On hit, apply poisoned via applySpellEffect (mirror Sunburst's
 *     blinded pattern — NOT concentration; persists for the v1 combat).
 *  6. Log the attack roll + damage + condition.
 *
 * v1 simplifications: poisoned save folded into the hit (no second
 * save — conservative); poisoned duration NOT tracked (persists for
 * combat); upcast NOT modelled; NOT concentration; crit DOES double
 * the dice (standard PHB p.196 crit rule).
 *
 * @param caster  The casting Combatant (Sorcerer — PHB p.271)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Ray of Sickness');
  // Hit bonus: prefer the action's hitBonus. Fall back to CHA mod
  // (Sorcerer primary — Ray of Sickness is a Sorcerer spell, PHB p.271).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.cha);

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Ray of Sickness! (ranged spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} + poisoned on hit, crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'attack_miss', caster.id,
      `Ray of Sickness: ${target.name} is already down — sickening ray fizzles.`,
      target.id,
    );
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Ray of Sickness (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no poison damage!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Ray of Sickness (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  // 2d8 poison damage; crit doubles the dice (PHB p.196).
  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Ray of Sickness: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );

  // On hit: apply the poisoned condition (mirror Sunburst's blinded).
  // NOT concentration — sourceIsConcentration: false. v1 simplification:
  // no second save to negate the poison (conservative — see metadata).
  // Constructs are immune to the poisoned condition (MM p.6) and to
  // poison damage — the engine's applyDamageWithTempHP handles poison
  // damage immunity via resistances, and the isConstruct flag gates
  // the condition application here.
  if (target.isConstruct) {
    emit(
      state, 'condition_add', caster.id,
      `${target.name} is a construct — immune to the poisoned condition (MM p.6).`,
      target.id,
    );
  } else if (!target.conditions.has('poisoned')) {
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Ray of Sickness',
      effectType: 'condition_apply',
      payload: { condition: 'poisoned' },
      sourceIsConcentration: false,   // PHB p.271: NOT concentration
    });
    emit(
      state, 'condition_add', caster.id,
      `${target.name} is POISONED by the sickening ray! (disadvantage on attacks and ability checks)`,
      target.id,
    );
  } else {
    emit(
      state, 'condition_add', caster.id,
      `${target.name} is already poisoned — Ray of Sickness's poison has no additional effect.`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Ray of Sickness — NO-OP in v1 because:
 *   - Ray of Sickness is NOT a concentration spell; the poisoned
 *     condition persists for the v1 combat duration (end-of-next-turn
 *     expiry NOT tracked).
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; condition persists for v1 combat.
}
