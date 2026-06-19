// ============================================================
// Shillelagh — PHB p.275
// Level 0 transmutation cantrip
//
// Casting time: bonus action  (note: NOT a regular action — this
//   is one of the few cantrips that casts as a bonus action)
// Range: Touch (the caster's own club or quarterstaff)
// Components: V + S + M (mistletoe, a shamrock leaf, and a club
//   or quarterstaff)
// Duration: 1 minute
// Effect: The wood of a club or quarterstaff you are holding is
//   imbued with nature's power. For the duration, you can use
//   your spellcasting ability instead of Strength for the attack
//   and damage rolls of melee attacks using that weapon, and the
//   weapon's damage die becomes a d8. The weapon also becomes
//   magical, if it isn't already. The spell ends if you cast it
//   again or if you let go of the weapon.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — 1-round duration,
// +1d8 radiant instead of "damage die becomes d8"):
// ────────────────────────────────────────────────────────────
// Shillelagh is the SECOND self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first is Blade Ward, PHB p.218). Like Blade Ward, it sets
// a scratch flag on the caster (`_shillelaghActive`) and is
// cleaned up by resetBudget(). Unlike Blade Ward (which grants
// damage resistance read by applyDamageWithTempHP), Shillelagh
// grants ATTACK-ROLL substitution + BONUS DAMAGE read by
// resolveAttack's attack-roll branch.
//
// v1 simplification: PHB p.275 says the duration is 1 minute (10
// rounds). v1 treats Shillelagh as a 1-round buff (clears at the
// start of the caster's next turn via cleanup() called from
// resetBudget(), mirroring Blade Ward's timing). Documented via
// the metadata flag `shillelaghDurationV1Simplified: true`.
// Future work: a persistent-buff subsystem that tracks 1-minute
// durations (also needed for Mage Armor's 8-hour duration).
//
// v1 simplification: PHB p.275 says "the weapon's damage die
// becomes a d8". Canonically, the weapon's OWN damage dice
// (1d6 for a club, 1d6 for a quarterstaff) is REPLACED by 1d8.
// v1 instead models this as +1d8 RADIANT damage on top of the
// weapon's existing damage dice. This sidesteps the engine
// complexity of identifying WHICH Action is the "club or
// quarterstaff" (the spell's material component) and replacing
// its damage dice in-place. The +1d8 radiant is a more generous
// interpretation (the weapon keeps its original damage AND gains
// +1d8 radiant), but it preserves the WIS-for-STR substitution
// (the cantrip's primary mechanical identity) and avoids the
// need to thread "which action is the Shillelagh-affected
// weapon" through the engine. Documented via the metadata flag
// `shillelaghDamageModelV1Simplified: true`.
//
// WIS-for-STR substitution:
//   - When `_shillelaghActive === true` AND `action.attackType
//     === 'melee'`, resolveAttack's attack-roll branch:
//       (a) recomputes hitBonus using WIS mod instead of STR mod
//           (delta = WIS_mod - STR_mod, applied to hitBonus)
//       (b) adds +1d8 radiant damage to the damage roll
//   - The substitution applies to MELEE attacks only (PHB p.275:
//     "melee attacks using that weapon"). Ranged and spell
//     attacks do NOT benefit. This mirrors Frostbite's
//     attack-type-restricted debuff pattern (Session 8) but for
//     a SELF-BUFF instead of a target debuff.
//
// Routing (per zHANDOVER-SESSION-9):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Shillelagh's Action (no target — self-buff).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Blade Ward's routing exactly.
//
// Registered in CANTRIP_SELF_EFFECTS (non-attack self-buff
// registry, alongside Blade Ward).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shillelagh',
  level: 0,
  school: 'transmutation',
  /** Range: Touch (the caster's own club or quarterstaff). */
  rangeFt: 0,
  /**
   * PHB p.275: Duration 1 minute (concentration NOT required —
   * the spell simply lasts 1 minute or until the caster casts it
   * again or lets go of the weapon). v1 simplification: treat
   * as a 1-round buff (clears at start of caster's next turn).
   */
  concentration: false,
  /**
   * Casting time: BONUS ACTION (PHB p.275). This is one of the
   * few cantrips that casts as a bonus action — the caster can
   * still take the Attack action on the same turn.
   */
  castingTime: 'bonusAction' as const,
  /** No damage dice in metadata — the cantrip buffs the weapon, not itself. */
  damageDice: null,
  /** v1 models the buff as +1d8 radiant on melee hits (see header). */
  damageType: 'radiant' as const,
  /** Does NOT scale at 5/11/17 (the +1d8 is the cantrip's flat effect, not a damage-scaling track). */
  scales: false as const,
  /** Components: V + S + M (mistletoe, a shamrock leaf, and a club or quarterstaff). */
  components: { v: true, s: true, m: true } as const,
  /** Self-buff flag — read by the AI/planner to know this is a non-attack cantrip. */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.275 says the duration is 1
   * minute (10 rounds). v1 treats Shillelagh as a 1-round buff
   * (clears at the start of the caster's next turn, mirroring
   * Blade Ward). Future work: a persistent-buff subsystem that
   * tracks 1-minute durations.
   */
  shillelaghDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.275 says "the weapon's damage
   * die becomes a d8". v1 instead adds +1d8 radiant on top of
   * the weapon's existing damage (preserves the WIS-for-STR
   * substitution, sidesteps the engine complexity of identifying
   * which Action is the buffed weapon). See header for details.
   */
  shillelaghDamageModelV1Simplified: true as const,
  /**
   * Rider restriction: the WIS-for-STR substitution + +1d8
   * radiant apply ONLY to melee attacks (PHB p.275: "melee
   * attacks using that weapon"). Ranged and spell attacks do
   * NOT benefit. Mirrors Frostbite's riderAttackTypes metadata
   * (Session 8) but for a self-buff instead of a target debuff.
   */
  riderAttackTypes: ['melee'] as const,
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
 * Apply Shillelagh's self-buff: set the caster's
 * `_shillelaghActive` flag. Called via resolveCantripAction()
 * from CANTRIP_SELF_EFFECTS in cantrip_effects.ts, which
 * executePlannedAction consults for non-attack cantrips (routing
 * them away from resolveAttack).
 *
 * While `_shillelaghActive === true`, resolveAttack's attack-
 * roll branch — when `action.attackType === 'melee'` —
 * substitutes WIS mod for STR mod in hitBonus AND adds +1d8
 * radiant damage to the damage roll. The buff is consumed
 * (cleared) at the start of the caster's NEXT turn by cleanup()
 * called from resetBudget (v1 1-round simplification; PHB p.275
 * canonically says 1 minute / 10 rounds).
 *
 * @returns true if the buff was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  const alreadyActive = caster._shillelaghActive === true;
  caster._shillelaghActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Shillelagh — ${alreadyActive ? 'already active' : 'melee attacks use WIS instead of STR and gain +1d8 radiant (v1: 1-round duration)'}!`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the `_shillelaghActive`
 * flag so the buff expires (v1 simplification: 1-round duration
 * per the metadata flag `shillelaghDurationV1Simplified`).
 *
 * Codebase convention: the buff clears at the start of the
 * CASTER's next turn (mirror Blade Ward). PHB p.275 canonically
 * says 1 minute (10 rounds), but v1 simplifies this to 1 round
 * to avoid the need for a persistent-buff subsystem.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._shillelaghActive !== undefined) {
    delete combatant._shillelaghActive;
  }
}
