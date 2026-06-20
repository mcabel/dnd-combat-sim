// ============================================================
// Chromatic Orb — PHB p.221
//
// 1st-level evocation, action, range 90 ft, NO concentration.
// Components: V, S, M (a diamond worth at least 50 gp).
//
// Effect: You hurl a 4-inch-diameter sphere of energy at a creature
//         that you can see within range. You choose acid, cold, fire,
//         lightning, poison, or thunder for the type of orb you
//         create, and then make a ranged spell attack against the
//         target. If the attack hits, the creature takes 3d8 damage
//         of the type you chose.
//
// Upcast: +1d8 damage per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Damage type choice: PHB lets the caster choose between acid,
//     cold, fire, lightning, poison, thunder. v1 picks the type the
//     target is LEAST resistant to — preferring (in order): a type
//     the target is NOT resistant to, then a type the target has no
//     explicit immunity to. If all types are equally viable, default
//     to fire. This avoids the trap of picking a damage type the
//     target resists.
//     Forward-compat TODO via `chromaticOrbSmartTypeChoiceV1Implemented: true`.
//   - Material component (50 gp diamond): NOT modelled — v1 has no
//     component cost tracking. Documented via
//     `chromaticOrbMaterialComponentV1Simplified: true`.
//   - Hit bonus: v1 falls back to the action's hitBonus (parser
//     populates it for spell attacks). If null, v1 falls back to
//     abilityMod(caster.int) (Wizard / Sorcerer primary). Mirrors
//     Scorching Ray's fallback pattern.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 3d8.
//     Forward-compat TODO via `chromaticOrbUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.221: instantaneous).
//   - Crit: per PHB p.196, the dice in the attack ARE doubled on a
//     crit. v1 DOES double the 3d8 on a crit (uses rollDamage with
//     isCrit=true).
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect).
// Session 21 migrated it to a bespoke implementation with REAL ranged
// spell attack + 3d8 chosen-elemental damage. Removed from
// `_generic_registry.ts`; routed via `case 'chromaticOrb':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Scorching
// Ray bespoke pattern (Session 18) but with a single-target attack
// instead of 3 rays, and a damage-type-choice heuristic.
//
// Spell module pattern (single-target ranged spell attack — mirrors
// scorching_ray.ts but with 1 attack instead of 3, 90-ft range instead
// of 120 ft, 3d8 chosen-elemental instead of 2d6 fire):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Constants ----------------------------------------------

/** The 6 damage types Chromatic Orb can produce, per PHB p.221. */
export const ORB_DAMAGE_TYPES: readonly DamageType[] = [
  'acid', 'cold', 'fire', 'lightning', 'poison', 'thunder',
] as const;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Chromatic Orb',
  level: 1,
  school: 'evocation',
  rangeFt: 90,
  dieCount: 3,
  dieSides: 8,
  concentration: false,
  castingTime: 'action',
  chromaticOrbSmartTypeChoiceV1Implemented: true,                  // picks least-resisted type
  chromaticOrbMaterialComponentV1Simplified: true,                 // 50 gp diamond NOT tracked
  chromaticOrbUpcastV1Implemented: false,                          // +1d8/slot-level NOT modelled
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

// ---- Damage-type picker -------------------------------------

/**
 * Pick the best damage type for Chromatic Orb to use against `target`.
 *
 * Heuristic (PHB p.221 lets the caster choose — v1 picks smartly):
 *   1. Filter to types the target does NOT resist (no entry in
 *      `target.resistances`).
 *   2. If all types are resisted, fall back to the full list.
 *   3. Among the survivors, pick the first in ORB_DAMAGE_TYPES order
 *      (acid → cold → fire → lightning → poison → thunder). Default
 *      to 'fire' if the list is empty (defensive).
 *
 * NOTE: v1 has no immunity field — only `resistances: DamageType[]`.
 * Vulnerabilities are also not modelled. Forward-compat TODO: extend
 * to skip immunities and prefer vulnerabilities once those fields
 * exist on Combatant.
 */
export function pickDamageType(target: Combatant): DamageType {
  const resisted = new Set(target.resistances ?? []);
  const nonResisted = ORB_DAMAGE_TYPES.filter(t => !resisted.has(t));
  const pool = nonResisted.length > 0 ? nonResisted : ORB_DAMAGE_TYPES;
  // Default to 'fire' if pool is empty (defensive — should never happen).
  return (pool[0] as DamageType | undefined) ?? 'fire';
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Chromatic Orb (a living enemy
 * within 90 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 90 ft — Chromatic
 *      Orb's 3d8 (avg 13.5) chosen-elemental damage is best spent
 *      against a high-HP target.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Chromatic Orb' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 90 ft
 *
 * Note: Chromatic Orb is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Chromatic Orb')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 90) continue;
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
 * Execute Chromatic Orb:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Pick the best damage type via pickDamageType (avoids target's resistances).
 *  3. Roll a ranged spell attack vs the target's AC.
 *  4. On hit: 3d8 <chosen type> damage. On crit: 6d8 (dice doubled).
 *  5. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect). NOTE: the smart-type picker should mean
 *     no resistance applies, but applyDamageWithTempHP is still used
 *     for safety + temp HP absorption.
 *  6. Log the attack roll + damage.
 *
 * v1 simplifications: smart type choice (avoids resistances);
 * material component NOT tracked; upcast NOT modelled; NOT
 * concentration; crit DOES double the dice (standard PHB p.196 crit
 * rule for spell attacks).
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard)
 * @param target  The target Combatant (must be within 90 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Chromatic Orb');
  // Hit bonus: prefer the action's hitBonus (parser populates it for
  // spell attacks). Fall back to INT mod (Wizard/Sorcerer primary).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.int);

  // Pick the best damage type — avoid target's resistances.
  const damageType = pickDamageType(target);

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Chromatic Orb! (ranged spell attack, ${metadata.dieCount}d${metadata.dieSides} ${damageType} on hit, crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'attack_miss', caster.id,
      `Chromatic Orb: ${target.name} is already down — spell fizzles.`,
      target.id,
    );
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Chromatic Orb (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no ${damageType} damage!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Chromatic Orb (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  // 3d8 <chosen type> damage; crit doubles the dice (PHB p.196).
  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, damageType);
  emit(
    state, 'damage', caster.id,
    `Chromatic Orb: ${target.name} takes ${dealt} ${damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Chromatic Orb — NO-OP because:
 *   - Chromatic Orb is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
