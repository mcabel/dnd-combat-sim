// ============================================================
// Magnify Gravity — EGtW p.161 (also XGE-related printings)
//
// 1st-level transmutation, action, range 60 ft, NO concentration.
// Components: V, S, M (a small iron ball).
//
// Effect: The gravitational pull in a 10-foot-radius sphere centered
//         on a point within range increases for a swift moment. Each
//         creature in that area must make a Constitution saving throw.
//         On a failed save, a creature takes 2d8 force damage, and its
//         speed is reduced by 5 feet until the start of your next turn.
//         On a successful save, a creature takes half as much damage
//         and suffers no reduction to its speed.
//
// Upcast: +1d8 force per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 10-ft radius sphere at a point within 60 ft. v1
//     simplification: targets the highest-threat enemy within 60 ft as
//     the sphere's centre, and applies the damage to ALL enemies within
//     10 ft of that centre (using chebyshev3D — square approximation
//     of the sphere). Mirrors the Shatter bespoke pattern (Session 18).
//   - Speed-reduction rider (EGtW p.161: "speed is reduced by 5 feet
//     until the start of your next turn"): NOT modelled — v1 has no
//     per-target timed-speed-modifier subsystem. Documented via
//     `magnifyGravitySpeedReductionV1Simplified: true`.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 2d8.
//     Forward-compat TODO via `magnifyGravityUpcastV1Implemented: false`.
//   - NOT a concentration spell (EGtW p.161: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL CON save + 2d8
// force AoE damage. Removed from `_generic_registry.ts`; routed via
// `case 'magnifyGravity':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Shatter bespoke pattern (Session 18) but
// with 2d8 force instead of 3d8 thunder, L1 slot instead of L2.
//
// Spell module pattern (AoE save radius — mirrors shatter.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Magnify Gravity',
  level: 1,
  school: 'transmutation',
  rangeFt: 60,                   // EGtW p.161: 60 ft
  aoeRadiusFt: 10,               // EGtW p.161: 10-ft radius sphere
  dieCount: 2,
  dieSides: 8,
  damageType: 'force' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  magnifyGravitySpeedReductionV1Simplified: true,                    // speed-reduction rider NOT modelled
  magnifyGravityUpcastV1Implemented: false,                          // +1d8/slot-level NOT modelled
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
 * Returns the list of enemies caught in a Magnify Gravity 10-ft-radius
 * sphere centred on the highest-threat enemy within 60 ft of the
 * caster, or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of
 *      the caster — this is the sphere's centre.
 *   2. Collect ALL living enemies within 10 ft of that centre (using
 *      chebyshev3D — square approximation of the sphere).
 *
 * Preconditions:
 *   - Caster has 'Magnify Gravity' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Magnify Gravity is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Magnify Gravity')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 60 ft of the caster (sphere centre).
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }

  if (!center) return null;

  // Collect all enemies within 10 ft of the centre (chebyshev3D * 5).
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 10) targets.push(e);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Magnify Gravity:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 2d8 force. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 10-ft radius (chebyshev square approx); speed-
 * reduction rider NOT modelled; upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Wizard / Sorcerer — EGtW p.161)
 * @param targets Candidates from shouldCast (all enemies in the 10-ft sphere)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Magnify Gravity');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Magnify Gravity! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Magnify Gravity (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Magnify Gravity: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Magnify Gravity — NO-OP because:
 *   - Magnify Gravity is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
