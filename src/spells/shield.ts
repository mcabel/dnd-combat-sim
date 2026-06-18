// ============================================================
// Shield — PHB p.275
//
// 1st-level abjuration, reaction
// Trigger: Being hit by an attack or targeted by Magic Missile
// Range: Self
// Duration: 1 round (until start of your next turn)
//
// Effect: +5 bonus to AC, including against the triggering attack.
//         No damage from Magic Missile.
//         No concentration.
//
// Implementation:
//   - Apply 'ac_bonus' ActiveEffect with acBonus = 5
//   - Effect expires at start of caster's next turn
//   - Special case: if triggered by Magic Missile, negate all damage
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  rangeFt: 0,           // self
  concentration: false,
  castingTime: 'reaction',
} as const;

// ---- shouldCast ---------------------------------------------

/**
 * Returns true if `caster` should cast Shield as a reaction.
 * Conditions:
 *   1. Has a 1st-level spell slot remaining
 *   2. Reaction is available (reactionUsed = false)
 *   3. Has Shield in their actions
 *   4. Not already under Shield effect
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Shield')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster.budget.reactionUsed) return false;

  const alreadyActive = caster.activeEffects.some((e: any) => e.spellName === 'Shield');
  if (alreadyActive) return false;

  return true;
}

// ---- execute ------------------------------------------------

/**
 * Execute Shield reaction:
 *   1. Consume a 1st-level spell slot
 *   2. Mark reaction as used
 *   3. Apply +5 AC bonus (expires at start of next turn)
 *   4. Log the action
 */
export function execute(caster: Combatant, state: EngineState, triggeringAttackName?: string): void {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Shield',
    effectType: 'ac_bonus',
    payload: { acBonus: 5 },
    sourceIsConcentration: false,
  });

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    description: `${caster.name} casts Shield (+5 AC until start of next turn)${triggeringAttackName ? ` vs ${triggeringAttackName}` : ''}!`,
  });
}

// ---- cleanup ------------------------------------------------

/**
 * Remove Shield effect at the start of the caster's next turn.
 * Called by resetBudget in utils.ts.
 */
export function cleanup(caster: Combatant): void {
  caster.activeEffects = caster.activeEffects.filter((e: any) => e.spellName !== 'Shield');
}