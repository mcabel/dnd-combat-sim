// ============================================================
// Cloudkill — PHB p.222
//
// 5th-level conjuration, action, range 120 ft, CONCENTRATION 10 min.
// Components: V, S.
//
// Effect: You create a 20-foot-radius sphere of poisonous, yellow-green
//         fog centered on a point you choose within range. The fog
//         spreads around corners. It lasts for the duration or until
//         strong wind disperses it. Its area is heavily obscured.
//
//         When a creature enters the spell's area for the first time
//         on a turn or starts its turn there, that creature must make
//         a Constitution saving throw. The creature takes 5d8 poison
//         damage on a failed save, or half as much damage on a
//         successful one. Creatures are affected even if they hold
//         their breath or don't need to breathe.
//
//         The fog moves 10 feet away from you at the start of each of
//         your turns, rolling along the surface of the ground. The
//         vapors, being heavier than air, sink to the lowest level of
//         the terrain, even pouring downward through openings.
//
// Upcast: +1d8 poison per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 120 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Damage: PHB p.222 says 5d8 poison (confirmed by SAC v2.7). The
//     handover document for Session 23 recommended "8d8" but that
//     appears to be a typo — the canonical PHB value is 5d8 (matching
//     the SPELL_DB entry). v1 uses 5d8. Documented via
//     `cloudkillDamage5d8Not8d8: true`.
//   - Moving AoE (PHB p.222: "moves 10 feet away from you at the
//     start of each of your turns"): NOT modelled — v1 has no "move
//     AoE" hook in the damage_zone subsystem. v1 treats Cloudkill as
//     a ONE-SHOT AoE (like Shatter) — it deals 5d8 poison once on cast
//     to all enemies in the 20-ft radius sphere, then dissipates.
//     Documented via `cloudkillMovingAoeV1Simplified: true`. A future
//     implementation should extend the damage_zone subsystem to
//     support移动 each turn (similar to Moonbeam's damage_zone, but
//     with a per-turn position update).
//   - Concentration (PHB p.222: concentration 10 min): v1 does NOT
//     model the concentration since the persistent effect is
//     simplified away. The spell is treated as instantaneous for v1
//     purposes (the one-shot damage is the only modelled effect).
//     Documented via `cloudkillConcentrationV1Simplified: true`.
//     metadata.concentration is set to FALSE to reflect the v1
//     one-shot behaviour (the canCast-concentration gate would
//     otherwise block the spell if the caster is already concentrating).
//   - Heavily obscured (PHB p.222: "Its area is heavily obscured"):
//     NOT modelled — v1 has no vision-blocking terrain in the AoE.
//     Documented via `cloudkillHeavilyObscuredV1Simplified: true`.
//   - Spread around corners / sink to lowest level: NOT modelled —
//     v1 has no 3D terrain.
//   - Wind dispersal: NOT modelled.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 5d8
//     poison. Forward-compat TODO via `cloudkillUpcastV1Implemented: false`.
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with REAL CON
// save + 5d8 poison AoE damage (the moving-AoE and concentration
// riders are simplified away). Removed from `_generic_registry.ts`;
// routed via `case 'cloudkill':` in combat.ts and a planner branch
// in planner.ts. Mirrors the Shatter bespoke pattern (Session 18)
// but with a 20-ft radius (vs Shatter's 10 ft), 5d8 poison (vs 3d8
// thunder), CON save (same), 120-ft range (vs 60 ft), and L5 slot
// (vs L2).
//
// Spell module pattern (AoE save — mirrors shatter.ts but with a
// 20-ft radius sphere, 5d8 poison, 120-ft range, L5 slot):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP, startConcentration } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Cloudkill',
  level: 5,
  school: 'conjuration',
  rangeFt: 120,                 // PHB p.222: 120 ft
  aoeRadiusFt: 20,              // PHB p.222: 20-ft radius sphere
  dieCount: 5,
  dieSides: 8,
  damageType: 'poison' as const,
  concentration: true,          // v2: persistent damage_zone (canon concentration 10 min)
  saveAbility: 'con' as const,
  castingTime: 'action',
  cloudkillDamage5d8Not8d8: true,                                   // PHB p.222: 5d8 (handover "8d8" was a typo)
  cloudkillMovingAoeV1Simplified: true,                             // no "move AoE" hook in v1
  cloudkillPersistentV2Implemented: true,                           // v2: damage_zone + concentration (was v1 one-shot)
  cloudkillHeavilyObscuredV1Simplified: true,                       // no vision-blocking terrain in v1
  cloudkillUpcastV1Implemented: false,                              // +1d8/slot-level NOT modelled
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
 * Returns the list of enemies caught in a Cloudkill 20-ft-radius
 * sphere centered on the highest-threat enemy within 120 ft of the
 * caster, or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 120 ft of
 *      the caster — this is the sphere's center.
 *   2. Collect ALL living enemies within 20 ft of that center (using
 *      chebyshev3D — square approximation of the sphere).
 *
 * Preconditions:
 *   - Caster has 'Cloudkill' in their actions
 *   - Caster has at least one 5th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 120 ft
 *
 * Note: v2 treats Cloudkill as concentration (the concentration
 * rider is now modelled — see metadata.cloudkillPersistentV2Implemented).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Cloudkill')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 120 ft of the caster (sphere center).
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
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
 * Execute Cloudkill (v1: one-shot AoE):
 *  1. Consume a 5th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 5d8 poison. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 20-ft radius (chebyshev square approximation);
 * one-shot AoE (moving-AoE NOT modelled); concentration rider NOT
 * modelled (treated as instantaneous); heavily obscured NOT modelled;
 * upcast NOT modelled.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (all enemies in the 20-ft sphere)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Cloudkill');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 5);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Cloudkill');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Cloudkill! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE, concentration) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught! (moving-AoE not modelled)`,
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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Cloudkill (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Cloudkill: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    // Persistent damage_zone — start-of-turn tick rolls CON save for half.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Cloudkill',
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.dieCount,
        dieSides: metadata.dieSides,
        damageType: metadata.damageType,
        saveDC,
        saveAbility: metadata.saveAbility,
      },
      sourceIsConcentration: true,
    });
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Cloudkill — NO-OP in v1 because:
 *   - v1 treats Cloudkill as a one-shot AoE (the persistent moving-
 *     cloud effect is simplified away — see metadata.cloudkillMovingAoeV1Simplified).
 *   - No concentration (simplified away), no scratch field, no
 *     damage_zone sentinel.
 *
 * A future implementation that adds the moving-AoE hook would need
 * to clean up the damage_zone sentinel here (mirror Moonbeam's cleanup).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
