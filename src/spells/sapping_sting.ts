// ============================================================
// Sapping Sting — EGW p.189
// Level 0 necromancy cantrip
//
// Casting time: action
// Range: 30 ft
// Components: V, S (verbal + somatic — no material)
// Effect: You sap the vitality of one creature you can see in
//   range. The target must succeed on a Constitution saving
//   throw or take 1d4 necrotic damage and fall prone.
//
// Scaling: +1d4 at 5th level (2d4), 11th (3d4), 17th (4d4).
//
// ────────────────────────────────────────────────────────────
// Implementation (condition-inflicting cantrip — first to
// apply a PHB Appendix A condition via the post-save-FAIL
// cantrip dispatcher):
// ────────────────────────────────────────────────────────────
// Rider: target falls PRONE on save-FAIL (EGW p.189).
//
// This is the FIRST cantrip to apply a PHB Appendix A condition
// (prone) via the cantrip dispatcher. The pattern is the simplest
// possible post-save-FAIL rider:
//   - applyCantripEffect calls addCondition(target, 'prone')
//   - No scratch field on Combatant needed (the `prone` condition
//     lives in `target.conditions`, the standard condition set).
//   - No cleanup() needed — `prone` is cleared by existing
//     condition-removal logic (the target standing up via the
//     action system, or `removeCondition(target, 'prone')` in
//     other engine paths). It is NOT cleared by resetBudget —
//     resetBudget only clears scratch fields set by cantrips,
//     not PHB Appendix A conditions.
//
// Consequence of prone:
//   - Melee/spell attacks against the prone target have ADVANTAGE
//   - Ranged attacks against the prone target have DISADVANTAGE
//   - The prone target has disadvantage on its own attack rolls
//   - The prone target must spend half its movement to stand up
//   (All handled by existing engine code: resolveAttackAdvantage
//    in utils.ts reads `target.conditions.has('prone')` and adjusts
//    advantage/disadvantage; attackAdvantageState reads
//    `attacker.conditions.has('prone')` for the attacker-side
//    disadvantage; standing-up is handled in the move system.)
//
// Registered in CANTRIP_EFFECTS (post-save-FAIL dispatcher).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { addCondition } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Sapping Sting',
  level: 0,
  school: 'necromancy',
  rangeFt: 30,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d4',
  damageType: 'necrotic',
  saveAbility: 'con' as const,
  /** Scales at levels 5/11/17 (EGW p.189). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d4', '3d4', '4d4'] as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
  /**
   * Condition inflicted by this cantrip's rider (post-save-FAIL).
   * `prone` is a PHB Appendix A condition tracked on
   * `target.conditions` — not a scratch field. Cleared by existing
   * condition-removal logic (standing up, death, etc.), NOT by
   * resetBudget/cleanup.
   */
  conditionInflicted: 'prone' as const,
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
 * Apply Sapping Sting's post-fail rider after the target fails
 * its Constitution save. Called from resolveAttack's save branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * when the save failed.
 *
 *   Rider: target falls PRONE (EGW p.189).
 *   Implementation: addCondition(target, 'prone').
 *
 *   The prone condition is tracked in `target.conditions` (PHB
 *   Appendix A condition set). It is NOT a scratch field and is
 *   NOT cleared by resetBudget/cleanup — it persists until the
 *   target stands up (handled by the action system) or another
 *   engine path removes it (e.g. removeCondition on death).
 *
 *   Consequence: melee/spell attacks vs the prone target gain
 *   advantage; ranged attacks vs it have disadvantage; the prone
 *   target has disadvantage on its own attack rolls. All handled
 *   by resolveAttackAdvantage() / attackAdvantageState() in
 *   utils.ts.
 *
 * @returns true if the rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  addCondition(target, 'prone');

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s Sapping Sting saps ${target.name}'s vitality — they fall prone!`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Sapping Sting has NO scratch
 * fields to clean up — the `prone` condition it inflicts is a
 * PHB Appendix A condition tracked on `target.conditions`, not a
 * cantrip scratch field. The prone condition is cleared by:
 *   - The target standing up (uses half movement — handled by
 *     the action/move system, future work to expose as a
 *     PlannedAction type).
 *   - The target falling unconscious or dying.
 *   - Other engine paths that call removeCondition(target, 'prone').
 *
 * This cleanup is intentionally a no-op — Sapping Sting's effect
 * is PERSISTENT (until removed by the standard condition system),
 * unlike Vicious Mockery / Mind Sliver / Frostbite / Booming Blade
 * which are ONE-SHOT scratch-field debuffs that must clear at the
 * start of the affected creature's next turn.
 *
 * Exported for symmetry with the other cantrip cleanup() functions
 * — future cantrip infrastructure may iterate over all cantrip
 * modules' cleanups; this ensures Sapping Sting is in the registry.
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — prone is a condition, not a scratch field.
}
