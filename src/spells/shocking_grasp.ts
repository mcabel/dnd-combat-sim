// ============================================================
// Shocking Grasp — PHB p.275
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Touch (5 ft) — melee spell attack
// Effect: On a hit, the target takes 1d8 lightning damage, and it
//         can't take reactions until the start of your next turn.
//
// Special: Advantage on the attack roll if the target is wearing
//          armor made of metal (PHB p.275).
//
// Implementation:
//   - Basic attack and damage handled by resolveAttack
//   - "No reactions" rider applied via applyCantripEffect after a hit
//   - "Advantage vs metal armor" evaluated BEFORE the roll via the
//     CANTRIP_ATTACK_ADVANTAGE registry in cantrip_effects.ts
//
// Reaction-lock timing (simplification, consistent with Ray of Frost):
//   PHB: "until the start of YOUR (caster's) next turn."
//   We set target.budget.reactionUsed = true on hit. resetBudget()
//   (utils.ts) already resets reactionUsed to false at the start of
//   the TARGET's next turn, which is the codebase's established
//   simplification ("combatant's next turn" rather than "caster's
//   next turn" — see zHANDOVER-SESSION-1 Ray of Frost note).
//   => No dedicated cleanup() is needed for this cantrip; the
//      reaction budget is already managed by resetBudget.
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shocking Grasp',
  level: 0,
  school: 'evocation',
  rangeFt: 5,           // touch
  concentration: false,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'lightning',
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

// ---- Pre-roll advantage: metal armor ------------------------

/**
 * Returns true if a Shocking Grasp attack against `target` should have
 * advantage because the target is wearing metal armor (PHB p.275).
 *
 * Metal armors (PHB): chain shirt, scale mail, breastplate, half plate,
 * ring mail, chain mail, splint, plate. The Combatant.hasMetalArmor flag
 * is populated by the parser when armor data is available; tests may set
 * it directly. Undefined / false → no advantage.
 *
 * Registered in CANTRIP_ATTACK_ADVANTAGE in src/engine/cantrip_effects.ts
 * and consulted by resolveAttack() in combat.ts before the d20 is rolled.
 */
export function cantripAttackAdvantage(
  _attacker: Combatant,
  target: Combatant,
): boolean {
  return !!target.hasMetalArmor;
}

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Shocking Grasp's "no reactions" rider after a hit.
 * Called from resolveAttack (via cantrip_effects dispatcher) after damage.
 *
 * Effect: target can't take reactions until the start of its next turn.
 * Implemented by setting target.budget.reactionUsed = true; resetBudget()
 * in utils.ts restores it to false at the start of the target's next turn.
 *
 * @returns true if the rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // Lock reactions. If the target already used its reaction this round,
  // this is a harmless no-op (still true). resetBudget restores it next turn.
  const alreadyLocked = target.budget.reactionUsed;
  target.budget.reactionUsed = true;

  emit(
    state, 'action', caster.id,
    `${caster.name}'s Shocking Grasp surges through ${target.name} — ${alreadyLocked ? 'reactions still locked' : 'no reactions until next turn'}!`,
    target.id,
  );

  return true;
}
