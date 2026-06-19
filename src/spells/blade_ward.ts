// ============================================================
// Blade Ward — PHB p.218
// Level 0 abjuration cantrip
//
// Casting time: action
// Range: Self
// Effect: Until the start of your next turn, you have resistance
//         against bludgeoning, piercing, and slashing damage dealt
//         by weapon attacks.
//
// Architecture note:
//   Blade Ward is the FIRST non-attack cantrip in the codebase (a
//   self-buff). It does NOT ride resolveAttack and does NOT trigger
//   the post-hit CANTRIP_EFFECTS map. To avoid adding a
//   `case 'Blade Ward'` to executePlannedAction (forbidden by the
//   "no case 'spellName' in executePlannedAction" rule), it is
//   registered in the new CANTRIP_SELF_EFFECTS map in
//   cantrip_effects.ts and routed by resolveCantripAction(), which
//   executePlannedAction consults for non-attack cantrips.
//
// Damage reduction:
//   The caster's _bladeWardActive flag is consulted by
//   applyDamageWithTempHP() in utils.ts. Using the damage choke point
//   (rather than resolveAttack) keeps the resistance logic in ONE
//   place, composes correctly with other resistances (Rage, Warding
//   Bond) and never double-halves (PHB p.197: resistance doesn't
//   stack). The slight scope broadening (also applies to save-based
//   B/P/S damage, which is rare) is acceptable and arguably correct.
//
// Timing (simplification, consistent with other cantrips):
//   PHB: "until the start of YOUR next turn."
//   Codebase convention: clears at the start of the CASTER's next
//   turn via resetBudget() → cleanup().
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Blade Ward',
  level: 0,
  school: 'abjuration',
  rangeFt: 0,            // Self
  concentration: false,
  castingTime: 'action',
  damageDice: null,      // no damage
  damageType: null,      // no damage
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId: undefined,
    value: undefined,
    description: desc,
  });
}

// ---- applySelfEffect -----------------------------------------

/**
 * Apply Blade Ward's self-buff: set the caster's _bladeWardActive flag.
 * Called via resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * While _bladeWardActive is true, applyDamageWithTempHP() in utils.ts
 * halves incoming bludgeoning/piercing/slashing damage.
 *
 * @returns true if the buff was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  const alreadyActive = caster._bladeWardActive === true;
  caster._bladeWardActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Blade Ward — ${alreadyActive ? 'ward already active' : 'resistance to bludgeoning/piercing/slashing until next turn'}!`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget() in utils.ts. Clears the _bladeWardActive flag so the
 * resistance expires.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._bladeWardActive !== undefined) {
    delete combatant._bladeWardActive;
  }
}
