// ============================================================
// Hex — PHB p.251
// 1st-level enchantment (Warlock bonus action, concentration)
//
// Casting:  Bonus action, range 90 ft
// Duration: Concentration, up to 1 hour
// Effect:   Until the spell ends, you deal an extra 1d6 necrotic
//           damage to the target whenever you hit it with an attack.
//           Also, choose one ability — target has disadvantage on
//           checks using that ability (AI always picks STR).
// Move:     If target drops to 0 HP you CAN use a bonus action to
//           move Hex to a new target (not yet implemented — low priority).
//
// Implementation notes:
//   - Applies 'hex_damage' ActiveEffect on target (casterId = warlock.id)
//   - Concentration tag applied here (not in hexPlan) so breakConcentration
//     cleans up the effect correctly
//   - Bonus-action-in-case: dispatched from executePlannedAction 'hex' case
//   - Hit bonus applied in resolveAttack after damage roll
// ============================================================

import { Combatant, Battlefield, AbilityScore } from '../types/core';
import { EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { distanceFt } from '../engine/movement';

// ---- shouldCast ---------------------------------------------

/**
 * Returns the target id to Hex, or null if Hex should not be cast.
 *
 * Conditions:
 *   1. Warlock has pact slot remaining
 *   2. Not already concentrating (would break an existing spell)
 *   3. Target is within 90 ft
 *   4. Target is not already hexed by this warlock (avoids slot waste)
 */
export function shouldCast(
  warlock: Combatant,
  targetId: string,
  battlefield: Battlefield
): boolean {
  const r = warlock.resources?.pactSlots;
  if (!r || r.remaining < 1) return false;
  if (warlock.concentration?.active) return false;

  const target = battlefield.combatants.get(targetId);
  if (!target || target.currentHP <= 0) return false;
  if (distanceFt(warlock.pos, target.pos) > 90) return false;

  // Already hexed by this warlock — don't spend another slot
  const alreadyHexed = target.activeEffects.some(
    e => e.effectType === 'hex_damage' && e.casterId === warlock.id
  );
  if (alreadyHexed) return false;

  return true;
}

// ---- execute ------------------------------------------------

/**
 * Apply the Hex effect to `target`.
 * - Adds 'hex_damage' ActiveEffect (sourceIsConcentration: true)
 * - Sets warlock concentration
 * - Does NOT consume slot — that is done in hexPlan (resources.ts) before dispatch
 */
export function execute(
  warlock: Combatant,
  target: Combatant,
  state: EngineState,
  _cursedAbility: AbilityScore = 'str'   // ability disadvantage — AI always picks STR
): void {
  // Set concentration
  warlock.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };

  const effectId = `hex_${warlock.id}_${target.id}_${Date.now()}`;

  applySpellEffect(target, {
    casterId: warlock.id,
    spellName: 'Hex',
    effectType: 'hex_damage',
    payload: { hexDie: 6 },
    sourceIsConcentration: true,
  });

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: warlock.id,
    type: 'action',
    targetId: target.id,
    description: `${warlock.name} casts Hex on ${target.name} (+1d6 necrotic on each hit)`,
  });
}
