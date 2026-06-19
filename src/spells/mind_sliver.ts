// ============================================================
// Mind Sliver — TCE p.108
// Level 0 enchantment cantrip
//
// Casting time: action
// Range: 60 ft
// Components: V (verbal only — no S, no M)
// Duration: 1 round
// Effect: You drive a disorienting spike of psychic energy into
//   the mind of one creature you can see within range. The
//   target must succeed on an Intelligence saving throw or take
//   1d6 psychic damage and subtract 1d4 from the next saving
//   throw it makes before the end of your next turn.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// ────────────────────────────────────────────────────────────
// Implementation (one-shot save debuff — mirrors Vicious Mockery):
// ────────────────────────────────────────────────────────────
// Rider: target takes −1d4 to its NEXT saving throw before the
//   end of the caster's next turn (TCE p.108).
//
// This is a one-shot SAVE debuff — the save-debuff analogue of
// Vicious Mockery's one-shot ATTACK debuff (zHANDOVER-SESSION-6).
// Mirror that pattern but at a different choke point:
//
//   Vicious Mockery: flag set on save-FAIL → folded into
//     `disadvantage` in resolveAttack's attack-roll branch →
//     consumed after the attack resolves.
//
//   Mind Sliver:      flag set on save-FAIL → folded into the
//     save TOTAL (subtract rollDie(4)) in rollSave() → consumed
//     after the save resolves. NEW CHOKE POINT: rollSave in
//     utils.ts (not resolveAttack).
//
// Mechanics:
//   - target._mindSliverDiePenaltyNextSave = 4  (d4)  [one-shot]
//   - rollSave() in utils.ts reads this flag, rolls rollDie(4),
//     subtracts from the save total, and CLEARS the flag
//     (sets to undefined) after the save resolves — success or
//     failure. The penalty applies to ANY saving throw the
//     target makes while the flag is set (str/dex/con/int/wis/cha).
//   - If the target makes no save before its next turn starts,
//     cleanup() (called from resetBudget) clears the flag.
//
// Timing (codebase convention, same as Vicious Mockery):
//   PHB/TCE: "before the end of YOUR [caster's] next turn."
//   Codebase: effects clear at the start of the AFFECTED
//   combatant's next turn via resetBudget() → cleanup().
//   This is slightly more lenient than PHB (target gets to
//   keep the debuff until ITS next turn even if that's after
//   the caster's next turn) but is consistent with the existing
//   one-shot-debuff timing convention.
//
// Registered in CANTRIP_EFFECTS (post-save-FAIL dispatcher).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mind Sliver',
  level: 0,
  school: 'enchantment',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'psychic',
  saveAbility: 'int' as const,
  /** Scales at levels 5/11/17 (TCE p.108). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /** Components: V only (no S, no M). */
  components: { v: true, s: false, m: false } as const,
  /**
   * Rider die size: the target subtracts rollDie(riderDieSides)
   * from its next save. Stored on the target as
   * `_mindSliverDiePenaltyNextSave = riderDieSides`.
   */
  riderDieSides: 4 as const,
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
 * Apply Mind Sliver's post-fail rider after the target fails
 * its Intelligence save. Called from resolveAttack's save branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * when the save failed.
 *
 *   Rider: target subtracts 1d4 from the next saving throw it
 *          makes before the end of the caster's next turn
 *          (TCE p.108).
 *   Implementation: target._mindSliverDiePenaltyNextSave = 4
 *     (one-shot — consumed in rollSave() in utils.ts after the
 *     next save resolves).
 *
 * @returns true if the rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  target._mindSliverDiePenaltyNextSave = metadata.riderDieSides;

  emit(
    state, 'action', caster.id,
    `${caster.name}'s Mind Sliver disorients ${target.name} — ${target.name} subtracts 1d4 from their next saving throw!`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget() in utils.ts. Clears the Mind Sliver one-shot save
 * penalty flag if it wasn't consumed by a save before the target's
 * next turn started (TCE p.108: "before the end of your next turn").
 *
 * Codebase convention: the affected creature is the target; the
 * flag clears at the start of the TARGET's next turn (slightly more
 * lenient than PHB's "end of caster's next turn" but consistent
 * with how Vicious Mockery is timed).
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._mindSliverDiePenaltyNextSave !== undefined) {
    delete combatant._mindSliverDiePenaltyNextSave;
  }
}
