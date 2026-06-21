// ============================================================
// Booming Blade — TCE p.106 (reprinted from SCAG p.142)
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Self (5-ft radius — must target one creature within 5 ft)
// Components: S, M (a melee weapon worth at least 1 sp)
// Duration: 1 round
// Effect: You brandish the weapon used in the spell's casting
//   and make a melee attack with it against one creature within
//   5 feet of you. On a hit, the target suffers the weapon
//   attack's normal effects and then becomes sheathed in booming
//   energy until the start of your next turn. If the target
//   WILLINGLY moves 5 feet or more before then, the target takes
//   1d8 thunder damage, and the spell ends.
//
// Scaling (TCE p.106 — two damage tracks):
//   - "thunder damage on moving" (the rider): 1d8 → 2d8 → 3d8 → 4d8
//     at levels 1 / 5 / 11 / 17.
//   - "thunder damage on hit" (extra on-hit thunder): 0d8 at 1–4,
//     +1d8 at 5–10, +2d8 at 11–16, +3d8 at 17+.
//
// ────────────────────────────────────────────────────────────
// v1 SIMPLIFICATION (this module):
// ────────────────────────────────────────────────────────────
// Booming Blade is the FIRST cantrip with TWO damage components:
//   (1) on-hit thunder damage (scales), AND
//   (2) a MOVEMENT-TRIGGERED thunder damage rider (also scales).
//
// For v1, this module models the spell as:
//   - A melee weapon attack (attackType='spell', reach=5) dealing
//     1d8 thunder damage on hit (simplification — at low levels
//     the on-hit damage should be 0d8 thunder + weapon damage,
//     but v1 ignores weapon damage and gives a flat 1d8 thunder
//     on hit at all levels so the cantrip is useful at 1st level).
//   - A post-hit rider: target._boomingBladePendingDamageDice =
//     '1d8' (the movement-trigger damage, scales with caster
//     level). When the target WILLS itself to move via executeMove
//     (forced movement via Thorn Whip pull / Thunderwave push
//     bypasses executeMove and does NOT trigger the rider), the
//     stored dice are rolled, the damage is applied, and the
//     flag is cleared.
//
// The on-hit damage dice (1d8 → 2d8 → 3d8 at 5/11/17) and the
// rider dice (1d8 → 2d8 → 3d8 → 4d8 at 1/5/11/17) are exposed
// in metadata for the AI/parser to use when building the Action.
//
// The movement hook lives in executeMove() in combat.ts (added
// in this session). It checks `_boomingBladePendingDamageDice`
// AFTER the mover's position is updated (the move succeeded) and
// BEFORE the opportunity-attack loop (the rider fires regardless
// of OAs). See the inline comment in executeMove for the
// "willingly" semantics.
//
// Registered in CANTRIP_EFFECTS (post-hit dispatcher).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Booming Blade',
  level: 0,
  school: 'evocation',
  /** Range: Self (5-ft radius — the melee target must be within 5 ft). */
  rangeFt: 5,
  concentration: false,
  castingTime: 'action',
  /**
   * On-hit damage dice (v1 simplification — flat 1d8 thunder at all
   * levels; canonically 0d8 at 1–4 + weapon damage, +1d8 at 5+, etc.
   * — see module header).
   */
  damageDice: '1d8',
  damageType: 'thunder',
  /**
   * Scales at levels 5/11/17 (TCE p.106). Both the on-hit thunder
   * AND the movement-trigger rider scale; v1 simplifies the on-hit
   * to a flat 1d8 (no weapon damage) and exposes the rider scaling
   * via scalingDiceRider.
   */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  /** On-hit thunder damage dice by level (v1 simplification: flat 1d8). */
  scalingDice: ['1d8', '1d8', '1d8'] as const,
  /**
   * Rider (movement-trigger) damage dice by level. The rider is
   * 1d8 at 1st level and scales to 2d8/3d8/4d8 at 5/11/17. The
   * AI/parser reads scalingDiceRider[0] for 1st–4th level casters,
   * [1] for 5th–10th, [2] for 11th–16th, and the max (4d8) at 17+.
   * The full level→rider-dice map is in `riderDiceByLevel`.
   */
  scalingDiceRider: ['1d8', '2d8', '3d8', '4d8'] as const,
  /** Full level → rider-dice map (1d8 base, scales at 5/11/17). */
  riderDiceByLevel: { 1: '1d8', 5: '2d8', 11: '3d8', 17: '4d8' } as const,
  /** Components: S + M (a melee weapon worth at least 1 sp). No V. */
  components: { v: false, s: true, m: true } as const,
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
 * Apply Booming Blade's post-hit rider after the melee spell
 * attack hits. Called from resolveAttack's attack-roll branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * on a hit.
 *
 *   Rider: the target becomes sheathed in booming energy until
 *          the start of the caster's next turn. If the target
 *          WILLS itself to move 5+ ft before then, it takes
 *          1d8 thunder damage (scales) and the spell ends
 *          (TCE p.106).
 *
 *   Implementation:
 *     target._boomingBladePendingDamageDice = riderDice
 *       (e.g. '1d8' at 1st–4th, '2d8' at 5th–10th, etc.)
 *     target._boomingBladeCasterId = caster.id
 *       (for log attribution when the rider detonates)
 *
 *   The rider is triggered by executeMove() in combat.ts (added
 *   in this session) — see the movement hook in executeMove.
 *   Forced movement (Thorn Whip pull, Thunderwave push, grapple
 *   drag) does NOT go through executeMove and does NOT trigger
 *   the rider (PHB p.196: "willingly" = uses the creature's own
 *   movement, not forced).
 *
 * @returns true if the rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // v1: default to 1d8 rider. The AI/parser can override this by
  // setting target._boomingBladePendingDamageDice before calling
  // resolveAttack (it would do this when building the Action for
  // a high-level caster). Here we use the 1st-level default.
  const riderDice = metadata.riderDiceByLevel[1];

  target._boomingBladePendingDamageDice = riderDice;
  target._boomingBladeCasterId = caster.id;

  emit(
    state, 'action', caster.id,
    `${target.name} is sheathed in booming energy from ${caster.name}'s Booming Blade — takes ${riderDice} thunder if they move willingly before the start of ${caster.name}'s next turn!`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget() in utils.ts. Clears the Booming Blade pending-damage
 * flag if the target didn't move willingly before its next turn
 * started (TCE p.106: "until the start of your [caster's] next turn").
 *
 * Codebase convention: the affected creature is the target; the flag
 * clears at the start of the TARGET's next turn (slightly more
 * lenient than PHB's "start of caster's next turn" but consistent
 * with how Vicious Mockery and Mind Sliver are timed).
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._boomingBladePendingDamageDice !== undefined) {
    delete combatant._boomingBladePendingDamageDice;
  }
  if (combatant._boomingBladeCasterId !== undefined) {
    delete combatant._boomingBladeCasterId;
  }
}

// ---- Rider detonation helper --------------------------------

/**
 * Roll a dice expression like '1d8' or '2d8' and return the sum.
 * Used by executeMove in combat.ts when the rider detonates.
 *
 * DEPRECATED (TG-013 housekeeping): this function now re-exports
 * `rollDiceString` from `src/engine/utils.ts`. The canonical
 * implementation lives there; this re-export is kept for backwards
 * compatibility with any caller that still imports from this module.
 *
 * New callers should import directly from `../engine/utils`.
 */
export { rollDiceString } from '../engine/utils';
