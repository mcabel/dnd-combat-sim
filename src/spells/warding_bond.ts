// ============================================================
// Warding Bond — PHB p.287
//
// 2nd-level abjuration, action, range Touch (5 ft), NO concentration.
// Duration: 1 hour.
//
// Effect on the bonded target (while within 30 ft of caster):
//   +1 AC, +1 to all saving throws, resistance to all damage types.
// Caster takes the same amount of damage as the bonded target whenever
// the target takes damage (redirect modelled in combat.ts).
//
// Bond ends when:
//   - Caster or target drops to 0 HP (handled in checkDeath / applyWardingBondRedirect)
//   - They are more than 30 ft apart (NOT enforced by the engine yet — deferred)
//   - Caster re-casts the spell (resource gate prevents this in AI)
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Warding Bond',
  level: 2,
  school: 'abjuration',
  rangeFt: 5,       // touch
  concentration: false,
  castingTime: 'action',
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

// ---- Planner ------------------------------------------------

/**
 * Returns the best ally target for Warding Bond, or null when the spell
 * should not be cast.
 *
 * Preconditions:
 *   - Caster has `resources.wardingBond.remaining > 0`
 *   - Caster is NOT already maintaining an active bond
 *     (checked by scanning the battlefield for .wardingBond.casterId === caster.id)
 *   - At least one living, unbonded ally is within 5 ft (touch range)
 *
 * Target selection: prefer the ally with the lowest HP percentage (most
 * vulnerable). On a tie, prefer the lowest AC (most at risk of being hit).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  // Resource gate
  if (!caster.resources?.wardingBond || caster.resources.wardingBond.remaining <= 0) {
    return null;
  }

  // Already bonded to someone on the field → don't recast
  for (const c of bf.combatants.values()) {
    if (c.wardingBond?.casterId === caster.id && !c.isDead && !c.isUnconscious) {
      return null;
    }
  }

  // Find eligible allies: same faction, alive, within 5 ft, not already bonded
  const candidates: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction !== caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (c.wardingBond !== null) continue; // already bonded to a different caster
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;
    candidates.push(c);
  }

  if (candidates.length === 0) return null;

  // Prefer the most vulnerable ally (lowest HP %). Break ties by lowest AC.
  candidates.sort((a, b) => {
    const hpA = a.currentHP / a.maxHP;
    const hpB = b.currentHP / b.maxHP;
    if (Math.abs(hpA - hpB) > 0.01) return hpA - hpB;
    return a.ac - b.ac;
  });

  return candidates[0];
}

// ---- Execution ----------------------------------------------

/**
 * Execute Warding Bond:
 *  1. Decrement caster's wardingBond.remaining.
 *  2. Set target.wardingBond = { casterId: caster.id }.
 *  3. Log the event.
 *
 * The mechanical effects (+1 AC, +1 saves, all-damage resistance, caster redirect)
 * are already wired into combat.ts and utils.ts and activate automatically whenever
 * target.wardingBond is non-null.
 *
 * @param caster  The casting Combatant
 * @param target  The ally receiving the bond (adjacent, alive, from shouldCast)
 * @param state   Current EngineState (for logging)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // Consume the resource
  if (caster.resources?.wardingBond) {
    caster.resources.wardingBond.remaining = Math.max(
      0,
      caster.resources.wardingBond.remaining - 1,
    );
  }

  // Apply the bond
  target.wardingBond = { casterId: caster.id };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Warding Bond on ${target.name}! ` +
    `(+1 AC, +1 saves, resistance, damage redirected to caster)`,
    target.id,
  );

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is now protected by Warding Bond (caster: ${caster.name})`,
    target.id,
  );
}
