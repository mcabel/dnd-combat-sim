// ============================================================
// ST-5: Mount ↔ Rider attack / damage redirect helpers
// Ruleset: PHB 2014 / TCE / SAC v2.7
//
// All official pre-2024 redirection is strictly Mount → Rider.
// These helpers are pure (no EngineState, no logging).
// Callers in combat.ts handle logging after inspecting return values.
// ============================================================

import { Combatant, Action, Battlefield } from '../types/core';
import { rollDie, profBonusByCR }          from './utils';

// ---- ST-5A: Mounted Combatant (feat) ─────────────────────

/**
 * Returns the rider if the Mounted Combatant feat redirect should apply; null otherwise.
 *
 * PHB (Mounted Combatant feat):
 *   "You can force an attack targeted at your mount to target you instead."
 *
 * Constraints (RAW):
 *   — Attack rolls only: hitBonus !== null AND attackType !== 'save'.
 *     Save-based effects (Fireball, Cone of Cold, Dragon Breath) cannot be redirected.
 *   — Auto-hits (hitBonus === null, e.g. Magic Missile) cannot be redirected.
 *   — No reaction cost — it is a free rider choice per RAW.
 *   — AI: always intercepts (it is strictly protective; no downside).
 */
export function checkMountedCombatant(
  target:  Combatant,
  action:  Action,
  bf:      Battlefield,
): Combatant | null {
  // Save-based attacks cannot be redirected
  if (action.attackType === 'save')   return null;
  // Auto-hit (hitBonus === null) cannot be redirected
  if (action.hitBonus === null)        return null;
  // Target must be a ridden controlled mount
  if (target.role !== 'mount' || !target.carriedBy) return null;

  const rider = bf.combatants.get(target.carriedBy);
  if (!rider || rider.isDead || rider.isUnconscious) return null;
  if (!rider.traits.includes('Mounted Combatant'))   return null;

  return rider;
}

// ---- ST-5B: Fighting Style — Protection ──────────────────

/**
 * Returns the rider if Fighting Style: Protection should impose disadvantage; null otherwise.
 *
 * PHB (Fighting Style: Protection):
 *   "When a creature you can see attacks a target other than you that is within 5 feet
 *   of you, you can use your reaction to impose disadvantage on the attack roll.
 *   You must be wielding a shield."
 *
 * For rider/mount: the rider is always within 5 ft of the mount.
 * Shield is assumed present when the rider chose this style (no equipment tracking).
 *
 * Side-effect when it fires: rider.budget.reactionUsed = true.
 * NOTE: Returns null if Mounted Combatant already fired (target ≠ mount in that case).
 */
export function checkProtectionStyle(
  target: Combatant,
  bf:     Battlefield,
): Combatant | null {
  if (target.role !== 'mount' || !target.carriedBy) return null;

  const rider = bf.combatants.get(target.carriedBy);
  if (!rider || rider.isDead || rider.isUnconscious)          return null;
  if (rider.budget.reactionUsed)                               return null;
  if (!rider.traits.includes('Fighting Style (Protection)'))   return null;

  rider.budget.reactionUsed = true;
  return rider;
}

// ---- ST-5C: Fighting Style — Interception ────────────────

/**
 * Returns the damage reduction if Fighting Style: Interception fires; 0 + null otherwise.
 *
 * TCE (Fighting Style: Interception):
 *   "When a creature you can see hits a target, other than you, that is within 5 feet
 *   of you with an attack, you can use your reaction to reduce the damage the target
 *   takes by 1d10 + your proficiency bonus (minimum of 0)."
 *
 * — Fires post-hit, pre-HP-application.
 * — Rider is always within 5 ft of their mount.
 * — Weapon/shield requirement assumed present (any melee combatant qualifies).
 * — Reduction capped to dmg so HP never goes negative.
 *
 * Side-effect when it fires: rider.budget.reactionUsed = true.
 */
export function checkInterceptionReduction(
  target: Combatant,
  dmg:    number,
  bf:     Battlefield,
): { reduction: number; rider: Combatant | null } {
  if (target.role !== 'mount' || !target.carriedBy) return { reduction: 0, rider: null };

  const rider = bf.combatants.get(target.carriedBy);
  if (!rider || rider.isDead || rider.isUnconscious)            return { reduction: 0, rider: null };
  if (rider.budget.reactionUsed)                                return { reduction: 0, rider: null };
  if (!rider.traits.includes('Fighting Style (Interception)'))  return { reduction: 0, rider: null };

  rider.budget.reactionUsed = true;
  const roll      = rollDie(10);
  const prof      = profBonusByCR(rider.cr);    // null cr → 2 (level-1 PC default)
  const reduction = Math.min(dmg, roll + prof); // never push dmg below 0
  return { reduction, rider };
}
