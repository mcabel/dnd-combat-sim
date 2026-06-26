// ============================================================
// Scorching Ray — PHB p.273
//
// 2nd-level evocation, action, range 120 ft, NO concentration.
// Components: V, S.
//
// Effect: You hurl a mundane or magical weapon attack that creates a
//         spray of fire, but here it's actually:
//         "You create three rays of fire and hurl them at targets within
//          range. You can hurl them at one target or several.
//          Make a ranged spell attack for each ray. On a hit, the target
//          takes 2d6 fire damage."
//
// Upcast: +1 ray per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Multi-attack: canon allows the caster to hurl the 3 rays at one
//     target OR several. v1 picks the highest-threat enemy within 120 ft
//     as the primary target; if fewer than 3 enemies are available, the
//     first (highest-threat) target is repeated to fill 3 slots so all 3
//     rays always have a target. This is a v1 simplification — canon
//     allows fewer than 3 rays to be fired (a ray is "wasted" if there's
//     no target). v1 wastes nothing. Documented via the metadata flag
//     `scorchingRayMultiTargetV1Simplified: true`.
//   - Upcast: +1 ray/slot-level NOT modelled — v1 always fires 3 rays.
//     Forward-compat TODO via `scorchingRayUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.273: instantaneous).
//   - No save (PHB p.273: ranged spell attack, no saving throw).
//   - Crit does NOT double (canon: the spell rolls fixed dice, not
//     weapon dice — PHB p.196 crit rule only doubles "damage dice in
//     the attack"; v1 simplification: no crit doubling for Scorching
//     Ray's fixed spell damage).
//
// Spell module pattern (NEW multi-attack variant):
//   shouldCast(caster, bf) → Combatant[] | null   (3 targets, may repeat)
//   execute(caster, targets, state) → void        (loops 3 times)
//   cleanup() — no-op (no persistent effect)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, rollAttack, applyDamageWithTempHP, abilityMod, elementalAffinityBonus } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Scorching Ray',
  level: 2,
  school: 'evocation',
  rangeFt: 120,
  rayCount: 3,                    // PHB p.273: 3 rays
  dieCount: 2,
  dieSides: 6,
  damageType: 'fire' as const,
  concentration: false,
  castingTime: 'action',
  scorchingRayMultiTargetV1Simplified: true,    // repeats first target if <3 enemies
  scorchingRayUpcastV1Implemented: true,         // +1 ray/slot-level above 2nd
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
 * Returns the list of 3 targets for Scorching Ray, or null when the
 * spell should not be cast.
 *
 * Target priority:
 *   1. Collect all living enemies within 120 ft of the caster.
 *   2. Sort by maxHP descending (highest-threat first), then by distance
 *      ascending (closest first as a tie-break).
 *   3. Return up to 3 targets. If fewer than 3 enemies are available,
 *      repeat the first (highest-threat) target to fill 3 slots so all
 *      3 rays have a target. v1 simplification — canon allows fewer rays.
 *
 * Preconditions:
 *   - Caster has 'Scorching Ray' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 living enemy exists within 120 ft
 *
 * Note: Scorching Ray is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 *
 * Returns: an array of exactly 3 Combatant references (possibly with
 * duplicates if there are fewer than 3 enemies), or null if casting
 * conditions are not met.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Scorching Ray')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  // Take up to 3 distinct enemies; if fewer, repeat the first to fill 3 slots.
  const distinct = candidates.slice(0, metadata.rayCount).map(e => e.c);
  const targets: Combatant[] = [];
  for (let i = 0; i < metadata.rayCount; i++) {
    targets.push(distinct[i % distinct.length]);
  }
  return targets;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Scorching Ray:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each of the 3 targets in the array (possibly with duplicates):
 *     a. Roll a ranged spell attack vs the target's AC.
 *     b. On hit (or crit): roll 2d6 fire damage, apply via
 *        applyDamageWithTempHP (handles resistances / temp HP / Warding
 *        Bond redirect).
 *     c. Log each ray's hit/miss + damage separately.
 *
 * v1 simplifications: 3 rays always fired (no upcast); first target
 * repeated to fill 3 slots if <3 enemies; NOT concentration; no crit
 * doubling for the spell's fixed dice.
 *
 * @param caster  The casting Combatant (Sorcerer/Wizard)
 * @param targets Array of 3 Combatant references from shouldCast (may
 *                contain duplicates if fewer than 3 enemies were available)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Scorching Ray');
  const hitBonus = action?.hitBonus ?? abilityMod(caster.int);

  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
  const rayCount = 3 + Math.max(0, slotLevel - 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Scorching Ray at L${slotLevel}! (${rayCount} rays, ranged spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit)`,
  );

  for (let i = 0; i < rayCount; i++) {
    const target = targets[i];
    if (!target) continue;

    // Re-check liveness (target may have died from an earlier ray this cast).
    if (target.isDead || target.isUnconscious) {
      emit(
        state, 'attack_miss', caster.id,
        `Ray ${i + 1}: ${target.name} is already down — ray fizzles.`,
        target.id,
      );
      continue;
    }

    const result = rollAttack(hitBonus, false, false);
    const effectiveAC = target.ac;

    if (result.total < effectiveAC && !result.isCrit) {
      emit(
        state, 'attack_miss', caster.id,
        `Ray ${i + 1}: ${caster.name} misses ${target.name} (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no fire damage!`,
        target.id, result.roll,
      );
      continue;
    }

    emit(
      state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
      `Ray ${i + 1}: ${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} (${result.total} vs AC ${effectiveAC})`,
      target.id, result.roll,
    );

    // 2d6 fire damage. Crit does NOT double (canon spell-dice rule).
    // Session 49 Task #29-follow-up-5c-2: Elemental Affinity (Draconic
    // Sorcerer 6) adds +CHA mod per ray that hits — EA applies to each
    // ray independently (each ray is a separate damage roll).
    const eaBonus = elementalAffinityBonus(caster, metadata.damageType);
    const dmg = rollDamage() + eaBonus;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `Ray ${i + 1}: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg})`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Scorching Ray — NO-OP because:
 *   - Scorching Ray is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
