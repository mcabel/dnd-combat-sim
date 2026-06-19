// ============================================================
// Vicious Mockery — PHB p.285
// Level 0 enchantment cantrip
//
// Casting time: action
// Range: 60 ft
// Components: V (verbal only — no somatic, no material)
// Effect: You unleash a string of insults laced with subtle
//   enchantments at a creature you can see within range. If the
//   target can hear you (though it need not understand you), it
//   must succeed on a Wisdom saving throw or take 1d4 psychic
//   damage and have disadvantage on the next attack roll it
//   makes before the end of its next turn.
//
// Scaling: +1d4 at 5th level (2d4), 11th (3d4), 17th (4d4).
//
// Implementation:
//   - Save-based cantrip → rides resolveAttack's save branch
//     (attackType: 'save', saveDC, saveAbility: 'wis').
//   - Rider (disadv on next attack) applies ONLY on save-FAIL.
//     resolveAttack's save branch calls applyCantripEffect()
//     after damage when `!save.success` — this is the new
//     dispatch point for save-based cantrips with post-fail
//     riders (matches the attack-hit dispatch at line ~393).
//   - Registered in CANTRIP_EFFECTS (post-fail dispatcher).
//   - Rider mechanics:
//       target._viciousMockeryDisadvNextAttack = true (one-shot)
//     resolveAttack's attack-roll branch folds this into the
//     `disadvantage` boolean when the marked creature is the
//     ATTACKER, then CONSUMES the flag (sets back to false)
//     after the attack roll resolves — hit or miss. This is
//     one-shot, distinct from Chill Touch's ongoing undead-disadv.
//   - Cleanup: cleanup(combatant) clears the flag if not
//     consumed; called from resetBudget() in utils.ts.
//
// Timing (simplification, consistent with Chill Touch / Ray of Frost):
//   PHB: "disadvantage on the next attack roll it makes before the
//         end of its next turn."
//   Codebase convention: effects clear at the start of the AFFECTED
//   combatant's next turn via resetBudget() → cleanup(). The
//   one-shot consume-on-next-attack semantics naturally handle the
//   "before the end of its next turn" clause — if the target doesn't
//   attack before its next turn starts, cleanup() clears the flag.
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Vicious Mockery',
  level: 0,
  school: 'enchantment',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d4',
  damageType: 'psychic',
  saveAbility: 'wis' as const,
  /** Scales at levels 5/11/17 (PHB p.285). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d4', '3d4', '4d4'] as const,
  /** Components: V only (no S, no M). */
  components: { v: true, s: false, m: false } as const,
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
 * Apply Vicious Mockery's post-fail rider after the target fails
 * its Wisdom save. Called from resolveAttack's save branch (via
 * cantrip_effects dispatcher) AFTER damage is dealt, ONLY when
 * the save failed.
 *
 *   Rider: target has disadvantage on the next attack roll it
 *          makes before the end of its next turn (PHB p.285).
 *   Implementation: target._viciousMockeryDisadvNextAttack = true
 *     (one-shot — consumed in resolveAttack's attack-roll branch).
 *
 * @returns true if the rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  target._viciousMockeryDisadvNextAttack = true;

  emit(
    state, 'action', caster.id,
    `${caster.name}'s Vicious Mockery shakes ${target.name} — disadvantage on their next attack!`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget() in utils.ts. Clears the Vicious Mockery one-shot
 * disadvantage flag if it wasn't consumed by an attack roll before
 * the target's next turn started (PHB p.285: "before the end of its
 * next turn").
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._viciousMockeryDisadvNextAttack !== undefined) {
    delete combatant._viciousMockeryDisadvNextAttack;
  }
}
