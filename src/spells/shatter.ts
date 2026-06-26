// ============================================================
// Shatter — PHB p.275
//
// 2nd-level evocation, action, range 60 ft, NO concentration.
// Components: V, S, M (a chip of mica).
//
// Effect: A sudden loud ringing noise, painfully intense, erupts from a
//         point of your choice within range. Each creature in a 10-foot-
//         radius sphere centered on that point must make a Constitution
//         saving throw. A creature takes 3d8 thunder damage on a failed
//         save, or half as much on a successful one.
//
//         A creature made of inorganic material such as stone, crystal,
//         or metal has disadvantage on this saving throw.
//
//         A nonmagical object that isn't being worn or carried also
//         takes the damage if it's in the spell's area.
//
// Upcast: +1d8 thunder per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 10-ft radius sphere at a point within 60 ft. v1
//     simplification: targets the highest-threat enemy within 60 ft as
//     the sphere's center, and applies the damage to ALL enemies within
//     10 ft of that center (using chebyshev3D — square approximation of
//     the sphere; canon would use euclideanDistFt to reject diagonal
//     corners). Forward-compat TODO via the metadata flag
//     `shatterEuclideanRadiusV1Simplified: false` (implicit — no flag
//     added because the simplification is geometric, not behavioural).
//   - Object damage (PHB p.275: "A nonmagical object that isn't being
//     worn or carried also takes the damage if it's in the spell's
//     area.") NOT modelled — v1 has no object HP subsystem.
//   - Inorganic-material disadvantage: v1 has no creature-type/material
//     tag — the disadvantage on the CON save is NOT applied.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 3d8 thunder.
//     Forward-compat TODO via `shatterUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.275: instantaneous).
//
// Spell module pattern (AoE save — mirrors burning_hands.ts but with
// a 10-ft radius sphere instead of a cone):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shatter',
  level: 2,
  school: 'evocation',
  rangeFt: 60,
  aoeRadiusFt: 10,             // PHB p.275: 10-ft radius sphere
  dieCount: 3,
  dieSides: 8,
  damageType: 'thunder' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  shatterUpcastV1Implemented: true,                             // +1d8/slot-level modelled via consumeSpellSlot return
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

/** Roll `diceCount`d`metadata.dieSides` and return the total. */
export function rollDamage(diceCount: number = metadata.dieCount): number {
  let total = 0;
  for (let i = 0; i < diceCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Shatter 10-ft-radius sphere
 * centered on the highest-threat enemy within 60 ft of the caster, or
 * null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of the
 *      caster — this is the sphere's center.
 *   2. Collect ALL living enemies within 10 ft of that center (using
 *      chebyshev3D — square approximation of the sphere).
 *
 * Preconditions:
 *   - Caster has 'Shatter' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Shatter is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Shatter')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 60 ft of the caster (sphere center).
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    // Threat proxy: maxHP. Tie-break: closest to caster.
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }

  if (!center) return null;

  // Collect all enemies within 10 ft of the center (chebyshev3D * 5).
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 10) targets.push(e);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Shatter:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 3d8 thunder. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 10-ft radius (chebyshev square approximation);
 * inorganic-material disadvantage NOT applied; object damage NOT modelled;
 * upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Bard/Sorcerer/Warlock/Wizard)
 * @param targets Candidates from shouldCast (all enemies in the 10-ft sphere)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Shatter');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
  const diceCount = 3 + Math.max(0, slotLevel - 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Shatter at L${slotLevel}! (DC ${saveDC} CON, ${diceCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage(diceCount);
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Shatter (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${diceCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Shatter: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Shatter — NO-OP because:
 *   - Shatter is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
