// ============================================================
// Fireball — PHB p.241
//
// 3rd-level evocation, action, range 150 ft, NO concentration.
// Components: V, S, M (a tiny ball of bat guano and sulfur).
//
// Effect: A bright streak flashes from your pointing finger to a
//         point you choose within range and then blossoms with a
//         low roar into an explosion of flame. Each creature in a
//         20-foot-radius sphere centered on that point must make a
//         Dexterity saving throw. A target takes 8d6 fire damage
//         on a failed save, or half as much on a successful one.
//
//         The fire spreads around corners. It damages unsecured
//         objects in the area and ignites flammable objects.
//
// Upcast: +1d6 fire per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 20-ft radius sphere centered on a point
//     within 150 ft of the caster. v1 simplification: targets the
//     highest-threat enemy within 150 ft as the sphere's center,
//     and applies the damage to ALL enemies within 20 ft of that
//     center (using chebyshev3D — square approximation of the
//     sphere; canon would use euclideanDistFt to reject diagonal
//     corners). Forward-compat TODO via the metadata flag
//     `fireballEuclideanRadiusV1Simplified: true`.
//   - "Spreads around corners" (PHB p.241): NOT modelled in v1 —
//     no LOS-substitution for AoE propagation. Documented via the
//     metadata flag `fireballCornerPropagationV1Implemented: false`.
//   - Object damage / flammable ignition (PHB p.241: "damages
//     unsecured objects ... ignites flammable objects"): NOT
//     modelled — v1 has no object HP subsystem.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 8d6
//     fire. Forward-compat TODO via `fireballUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.241: instantaneous).
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (set `_genericSpellActiveSpells`
// on the caster, no mechanical effect). Session 21 migrated it to
// a bespoke implementation with REAL DEX save + 8d6 fire damage.
// Removed from `_generic_registry.ts`; routed via `case 'fireball':`
// in combat.ts and a planner branch in planner.ts. Mirrors the
// Shatter bespoke pattern (Session 18).
//
// Spell module pattern (AoE save — mirrors shatter.ts but with a
// 20-ft radius sphere instead of 10-ft, 8d6 fire instead of 3d8
// thunder, DEX save instead of CON, range 150 ft instead of 60):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState, rollSaveReactable } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Fireball',
  level: 3,
  school: 'evocation',
  rangeFt: 150,
  aoeRadiusFt: 20,             // PHB p.241: 20-ft radius sphere
  dieCount: 8,
  dieSides: 6,
  damageType: 'fire' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  fireballEuclideanRadiusV1Simplified: true,                       // chebyshev square approx
  fireballCornerPropagationV1Implemented: false,                   // "around corners" NOT modelled
  fireballUpcastV1Implemented: false,                              // +1d6/slot-level NOT modelled
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
 * Returns the list of enemies caught in a Fireball 20-ft-radius sphere
 * centered on the highest-threat enemy within 150 ft of the caster, or
 * null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 150 ft of
 *      the caster — this is the sphere's center.
 *   2. Collect ALL living enemies within 20 ft of that center (using
 *      chebyshev3D — square approximation of the sphere).
 *
 * Preconditions:
 *   - Caster has 'Fireball' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 150 ft
 *
 * Note: Fireball is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 *
 * Heuristic: v1 fires on >=1 target. A real Fireball should usually
 * be saved for >=2 clustered targets, but in v1 a single-target 8d6
 * (avg 28) fireball still beats most L3 alternatives. Forward-compat
 * TODO: add a cluster-density threshold (>=2 enemies in radius) via
 * a future `fireballClusterThreshold` planner config.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Fireball')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 150 ft of the caster (sphere center).
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 150) continue;
    // Threat proxy: maxHP. Tie-break: closest to caster.
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }

  if (!center) return null;

  // Collect all enemies within 20 ft of the center (chebyshev3D * 5).
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 20) targets.push(e);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Fireball:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's DEX save vs the caster's saveDC.
 *     b. On fail: 8d6 fire. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 20-ft radius (chebyshev square approximation);
 * "spreads around corners" NOT modelled; object damage / flammable
 * ignition NOT modelled; upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard / Light Cleric
 *                via domain / Warlock via Fiend patron, etc.)
 * @param targets Candidates from shouldCast (all enemies in the 20-ft sphere)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Fireball');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 3);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Fireball! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Fireball (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Fireball: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Fireball — NO-OP because:
 *   - Fireball is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
