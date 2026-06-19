// ============================================================
// Chill Touch — PHB p.221
// Level 0 necromancy cantrip
//
// Casting time: action
// Range: 120 ft (ranged spell attack)
// Effect: On a hit, the target takes 1d8 necrotic damage, and:
//   1. The target can't regain hit points until the start of your
//      next turn.
//   2. If the target is undead, it has disadvantage on attack rolls
//      against you until the end of your next turn.
//
// Implementation:
//   - Basic attack and damage handled by resolveAttack in combat.ts.
//   - Both riders applied via applyCantripEffect (post-hit) below,
//     dispatched from CANTRIP_EFFECTS in cantrip_effects.ts.
//   - Rider 1 (no healing): sets target._chillTouchNoHealing = true.
//     applyHeal() in utils.ts checks this flag and returns 0.
//   - Rider 2 (undead disadv): if target.isUndead, sets
//     target._chillTouchDisadvVs = caster.id. resolveAttack() in
//     combat.ts folds this into the attack's disadvantage when the
//     undead is attacking that specific caster.
//
// Timing (simplification, consistent with Shocking Grasp / Ray of Frost):
//   PHB: "until the start/end of YOUR (caster's) next turn."
//   Codebase convention: effects clear at the start of the AFFECTED
//   combatant's next turn via resetBudget() → cleanup(). This is the
//   established simplification (see zHANDOVER-SESSION-1 Ray of Frost
//   note and zHANDOVER-SESSION-2 Shocking Grasp note).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Chill Touch',
  level: 0,
  school: 'necromancy',
  rangeFt: 120,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'necrotic',
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

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Chill Touch's post-hit riders after a hit.
 * Called from resolveAttack (via cantrip_effects dispatcher) after damage.
 *
 *   Rider 1: target can't regain HP until the start of caster's next turn.
 *            (Simplified: clears at start of target's next turn via cleanup.)
 *   Rider 2: if the target is undead, it has disadvantage on attack rolls
 *            against the caster until the end of caster's next turn.
 *
 * @returns true if any rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // Rider 1: no healing
  target._chillTouchNoHealing = true;

  // Rider 2: undead disadvantage vs caster (only if target is undead)
  const isUndead = target.isUndead === true;
  if (isUndead) {
    target._chillTouchDisadvVs = caster.id;
  }

  const undeadClause = isUndead
    ? ` — ${target.name} (undead) has disadvantage on attacks vs ${caster.name}!`
    : '';

  emit(
    state, 'action', caster.id,
    `${caster.name}'s Chill Touch drains ${target.name} — no healing until next turn${undeadClause}!`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget() in utils.ts. Clears Chill Touch's transient scratch
 * fields so the riders expire.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._chillTouchNoHealing !== undefined) {
    delete combatant._chillTouchNoHealing;
  }
  if (combatant._chillTouchDisadvVs !== undefined) {
    delete combatant._chillTouchDisadvVs;
  }
}
