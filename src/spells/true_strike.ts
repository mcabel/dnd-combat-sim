// ============================================================
// True Strike — PHB p.284
// Level 0 divination cantrip
//
// Casting time: action
// Range: 30 ft
// Components: S only  (CANON NOTE: the 5etools spell-cache JSON
//   lists {"s":true} — NO material component. The Session 10
//   handover mentioned "a small piece of sheep's wool", which
//   is the canonical 2014 PHB component, but the 5etools JSON
//   for the in-scope pre-2024 source lists S only. This module
//   follows the canon JSON (S only), per the Session 9 protocol
//   of always cross-checking the handover's component list
//   against the 5etools spell-cache JSON before implementing.)
// Duration: 1 round (concentration)
// Effect: You extend your hand and point a finger at a target in
//   range. Your magic grants you a brief insight into the
//   target's defenses. On your next turn, you gain advantage on
//   your first attack roll against the target, provided that
//   this spell hasn't ended.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — 1-round non-concentration
// self-buff, advantage on next attack regardless of target):
// ────────────────────────────────────────────────────────────
// True Strike is the THIRD self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first two are Blade Ward and Shillelagh). Like Blade Ward
// and Shillelagh, it sets a scratch flag on the caster
// (`_trueStrikeAdvNextAttack`) and is cleaned up by resetBudget().
// Unlike Blade Ward (which grants damage resistance read by
// applyDamageWithTempHP) and Shillelagh (which grants attack-
// roll substitution + bonus damage read by resolveAttack's
// attack-roll branch), True Star grants ADVANTAGE on the next
// attack roll — read by resolveAttack's attack-roll branch.
//
// v1 simplification: PHB p.284 canonically requires concentration
// and lasts up to 1 minute. v1 treats True Star as a 1-round,
// non-concentration buff (clears at the start of the caster's
// next turn via cleanup() called from resetBudget(), mirroring
// Blade Ward's timing). Documented via the metadata flag
// `trueStrikeConcentrationV1Simplified: true`.
//
// v1 simplification: PHB p.284 canonically grants advantage on
// the first attack roll against THE TARGET (i.e. the specific
// creature True Star was cast on). v1 is target-agnostic — the
// buff applies to the caster's NEXT attack roll regardless of
// the target. This sidesteps the engine complexity of tracking
// which creature True Star was cast on (a "True Star mark" on
// the target). Documented via the metadata flag
// `trueStrikeTargetAgnosticV1Simplified: true`.
//
// Distinct from Shocking Grasp (the other advantage-granting
// cantrip): Shocking Grasp grants advantage on the SAME turn
// (pre-roll, vs metal armor — read by CANTRIP_ATTACK_ADVANTAGE).
// True Star grants advantage on a LATER turn's first attack,
// regardless of target (scratch flag, read by resolveAttack's
// attack-roll branch).
//
// Distinct from Frostbite (the other attack-debuff cantrip):
// Frostbite imposes DISADVANTAGE on the next WEAPON attack (the
// flag is set on the TARGET, attack-type-restricted). True Star
// grants ADVANTAGE on the next attack of ANY type (the flag is
// set on the CASTER, no attack-type restriction — melee, ranged,
// AND spell attacks all benefit).
//
// Advantage integration (resolveAttack attack-roll branch):
//   - When `attacker._trueStrikeAdvNextAttack === true`, fold
//     into the `advantage` boolean (mirror Frostbite's
//     `_frostbiteDisadvNextWeaponAttack` but for advantage
//     instead of disadvantage, and NOT restricted by attackType).
//   - Consume (set to false) after the attack roll resolves —
//     one-shot (PHB p.284: "your first attack roll", singular).
//
// Routing (per zHANDOVER-SESSION-10):
//   - The AI planner emits a normal `cast` PlannedAction with
//     True Star's Action (no target — self-buff, or a target
//     that v1 ignores per the target-agnostic simplification).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Blade Ward / Shillelagh's routing exactly.
//
// Registered in CANTRIP_SELF_EFFECTS (non-attack self-buff
// registry, alongside Blade Ward and Shillelagh).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'True Strike',
  level: 0,
  school: 'divination',
  /** Range: 30 ft (PHB p.284). */
  rangeFt: 30,
  /**
   * PHB p.284 canonically requires concentration, up to 1 minute.
   * v1 simplification: treat as a 1-round, NON-concentration buff
   * (clears at start of caster's next turn). See module header.
   */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — True Strike is a pure advantage self-buff. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the advantage buff is flat). */
  scales: false as const,
  /**
   * Components: S only (CANON — 5etools JSON: {"s":true}).
   * See module header for the canon-note discrepancy with the
   * Session 10 handover (which mentioned sheep's wool M component).
   */
  components: { v: false, s: true, m: false } as const,
  /** Self-buff flag — read by the AI/planner to know this is a non-attack cantrip. */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.284 canonically requires
   * concentration, up to 1 minute. v1 treats True Strike as a
   * 1-round, non-concentration buff (clears at start of caster's
   * next turn). Future work: a persistent-buff subsystem that
   * tracks 1-minute durations and concentration.
   */
  trueStrikeConcentrationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.284 canonically grants advantage
   * on the first attack roll against THE TARGET (the specific
   * creature True Strike was cast on). v1 is target-agnostic —
   * the buff applies to the caster's NEXT attack roll regardless
   * of target. Future work: a "True Strike mark" on the target,
   * checked in resolveAttack's advantage boolean.
   */
  trueStrikeTargetAgnosticV1Simplified: true as const,
  /**
   * Rider restriction: NONE — True Strike's advantage applies to
   * ANY attack roll (melee, ranged, AND spell attacks). Mirror
   * Vicious Mockery (which also applies to all attack types), but
   * for ADVANTAGE on the CASTER instead of DISADVANTAGE on the
   * TARGET. Distinct from Frostbite, which is weapon-only.
   */
  riderAttackTypes: ['melee', 'ranged', 'spell'] as const,
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
 * Apply True Strike's self-buff: set the caster's
 * `_trueStrikeAdvNextAttack` flag. Called via resolveCantripAction()
 * from CANTRIP_SELF_EFFECTS in cantrip_effects.ts, which
 * executePlannedAction consults for non-attack cantrips (routing
 * them away from resolveAttack).
 *
 * While `_trueStrikeAdvNextAttack === true`, resolveAttack's attack-
 * roll branch folds this into the `advantage` boolean (mirror
 * Frostbite's `_frostbiteDisadvNextWeaponAttack` but for advantage
 * instead of disadvantage, and NOT restricted by attackType —
 * True Strike applies to ANY attack roll). The buff is consumed
 * (cleared) immediately after the attack roll resolves — one-shot
 * (PHB p.284: "your first attack roll", singular). If not consumed
 * by an attack before the start of the caster's NEXT turn, cleanup()
 * (called from resetBudget) clears the flag (v1 1-round simplification).
 *
 * @returns true if the buff was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  const alreadyActive = caster._trueStrikeAdvNextAttack === true;
  caster._trueStrikeAdvNextAttack = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts True Strike — ${alreadyActive ? 'already active' : 'gains advantage on next attack roll (v1: 1-round, target-agnostic)'}!`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the
 * `_trueStrikeAdvNextAttack` flag so the buff expires (v1
 * simplification: 1-round duration per the metadata flag
 * `trueStrikeConcentrationV1Simplified`).
 *
 * Codebase convention: the buff clears at the start of the
 * CASTER's next turn (mirror Blade Ward / Shillelagh). PHB p.284
 * canonically says concentration up to 1 minute, but v1 simplifies
 * this to 1 round to avoid the need for a persistent-buff
 * subsystem.
 *
 * Note: canonically, the buff is consumed by the first attack
 * (one-shot), so cleanup is a safety net — if the caster makes
 * no attack on their next turn, the buff expires at the start of
 * the turn after that.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._trueStrikeAdvNextAttack !== undefined) {
    delete combatant._trueStrikeAdvNextAttack;
  }
}
