// ============================================================
// Guidance — PHB p.248
// Level 0 divination cantrip
//
// Casting time: action
// Range: Touch (one willing creature — can target self or ally)
// Components: V + S  (CANON — 5etools JSON: {"v":true,"s":true}, NO M)
// Duration: 1 minute (concentration)
// Effect: You touch one willing creature. Once before the spell
//   ends, the target can roll a d4 and add the number rolled to
//   one ability check of its choice. It can roll the die before
//   or after making the ability check. The spell then ends.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — 1-round non-concentration
// self-buff, +1d4 to next ability check; mirrors Resistance's
// +1d4 to next save, but for ability checks instead of saves):
// ────────────────────────────────────────────────────────────
// Guidance is the FIFTH self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first four are Blade Ward, Shillelagh, True Strike,
// Resistance). Like them, it sets a scratch flag on the target
// and is cleaned up by resetBudget(). Like Resistance (whose
// flag is consumed by rollSave in utils.ts), Guidance's flag is
// consumed by rollAbilityCheck() in utils.ts (added in Session 14 —
// the choke point that was previously missing). The flag is set on
// cast by applySelfEffect (below) and CONSUMED by the next ability
// check (any ability — str/dex/con/int/wis/cha). If the caster
// makes no ability check before their next turn, cleanup() (called
// from resetBudget) clears the flag as a safety net (v1 1-round
// simplification — canonically concentration up to 1 minute).
//
// v1 simplification: PHB p.248 canonically requires concentration,
// lasts up to 1 minute, and can target ANY willing creature (touch
// range — self OR ally). v1 treats Guidance as a 1-round,
// non-concentration SELF-buff (the caster targets themselves; the
// touch-ally mode is documented as TODO). Documented via the
// metadata flags `guidanceConcentrationV1Simplified: true` and
// `guidanceTouchAllyV1Simplified: true`.
//
// Mirrors Resistance (PHB p.272) — same architecture, same die
// size (4 = d4), same one-shot consume semantics, but for ABILITY
// CHECKS instead of SAVES:
//   Resistance: _resistanceDieBonusNextSave        = 4 (d4)  [save bonus, consumed by rollSave]
//   Guidance:   _guidanceDieBonusNextAbilityCheck  = 4 (d4)  [ability-check bonus, consumed by rollAbilityCheck]
//
// The flag is stored as the die size (4 = d4) so the system is
// extensible to other die bonuses (e.g. a hypothetical "Enhanced
// Guidance" cantrip that adds 1d6 — set the flag to 6).
//
// Ability-check-bonus integration (rollAbilityCheck in utils.ts —
// implemented in Session 14):
//   - When `combatant._guidanceDieBonusNextAbilityCheck` is set,
//     rollAbilityCheck() rolls rollDie(value) and ADDS the result
//     to the ability-check total (mirror Resistance's save-bonus
//     integration, but for ability checks instead of saves).
//   - Consume (set to undefined) after the ability check resolves
//     — one-shot (PHB p.248: "Once before the spell ends").
//   - The integration IS implemented (metadata flag
//     `guidanceAbilityCheckIntegrationV1Implemented: true`). The
//     remaining v1 simplifications are concentration (1-round vs
//     canon 1-minute concentration) and touch-ally (self-only vs
//     canon any willing creature) — see those metadata flags.
//
// Routing (per zHANDOVER-SESSION-11):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Guidance's Action (no target — self-buff v1; the touch-ally
//     mode is TODO).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Blade Ward / Shillelagh / True Strike /
//     Resistance's routing exactly.
//
// Registered in CANTRIP_SELF_EFFECTS (non-attack self-buff
// registry, alongside Blade Ward, Shillelagh, True Strike,
// Resistance).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Guidance',
  level: 0,
  school: 'divination',
  /** Range: Touch (PHB p.248 — can target self or ally). */
  rangeFt: 0,
  /**
   * PHB p.248 canonically requires concentration, up to 1 minute.
   * v1 simplification: treat as a 1-round, NON-concentration buff
   * (clears at start of caster's next turn). See module header.
   */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Guidance is a pure ability-check-bonus self-buff. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the +1d4 ability-check bonus is flat). */
  scales: false as const,
  /**
   * Components: V + S (CANON — 5etools JSON: {"v":true,"s":true}, NO M).
   * Cross-checked against the 5etools spell-cache JSON per the
   * Session 9 protocol — the handover also listed V+S (no M), canon
   * confirmed.
   */
  components: { v: true, s: true, m: false } as const,
  /** Self-buff flag — read by the AI/planner to know this is a non-attack cantrip. */
  isSelfBuff: true as const,
  /**
   * Rider die size: the target adds rollDie(riderDieSides) to its
   * next ability check. Stored on the target as
   * `_guidanceDieBonusNextAbilityCheck = riderDieSides`. Mirror
   * Resistance's `riderDieSides: 4` metadata pattern.
   */
  riderDieSides: 4 as const,
  /**
   * v1 simplification flag: PHB p.248 canonically requires
   * concentration, up to 1 minute. v1 treats Guidance as a
   * 1-round, non-concentration buff (clears at start of caster's
   * next turn). Future work: a persistent-buff subsystem that
   * tracks 1-minute durations and concentration.
   */
  guidanceConcentrationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.248 canonically allows targeting
   * ANY willing creature (touch range — self OR ally). v1 treats
   * Guidance as a SELF-buff only (the caster targets themselves).
   * Future work: a touch-ally targeting mode that sets the flag on
   * a different combatant.
   */
  guidanceTouchAllyV1Simplified: true as const,
  /**
   * v1 simplification flag: the rollAbilityCheck() choke point in
   * utils.ts now EXISTS (added in Session 14). v1 sets the
   * `_guidanceDieBonusNextAbilityCheck` flag on cast and CONSUMES
   * it on the next ability check (any ability — str/dex/con/int/
   * wis/cha) via rollAbilityCheck, which ADDS rollDie(value) to
   * the ability-check total (mirror Resistance's rollSave
   * integration, but for ability checks). The flag is cleared
   * at the start of the caster's NEXT turn via cleanup() called
   * from resetBudget as a SAFETY NET (v1 1-round simplification —
   * canonically concentration up to 1 minute). The remaining v1
   * simplifications are concentration (1-round vs canon 1-minute
   * concentration) and touch-ally (self-only vs canon any willing
   * creature) — see those metadata flags.
   */
  guidanceAbilityCheckIntegrationV1Implemented: true as const,
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
 * Apply Guidance's self-buff: set the caster's
 * `_guidanceDieBonusNextAbilityCheck` flag to 4 (d4). Called via
 * resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * While `_guidanceDieBonusNextAbilityCheck` is set, the
 * rollAbilityCheck() choke point in utils.ts (implemented in
 * Session 14) rolls rollDie(value) (a d4) and ADDS the result
 * to the ability-check total (mirror Resistance's save-bonus
 * integration, but for ability checks instead of saves), then
 * CONSUMES the flag (sets to undefined) after the ability check
 * resolves — success or failure. The bonus applies to ANY
 * ability check the caster makes while the flag is set
 * (str/dex/con/int/wis/cha). If the caster makes no ability
 * check before their next turn, the flag is cleared by cleanup()
 * called from resetBudget as a safety net (v1 1-round
 * simplification).
 *
 * @returns true if the buff was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  const alreadyActive = caster._guidanceDieBonusNextAbilityCheck !== undefined;
  caster._guidanceDieBonusNextAbilityCheck = metadata.riderDieSides;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Guidance — ${alreadyActive ? 'already active' : 'gains +1d4 to next ability check (v1: 1-round, self-only; consumed by rollAbilityCheck)'}!`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the
 * `_guidanceDieBonusNextAbilityCheck` flag so the buff expires
 * (v1 simplification: 1-round duration per the metadata flag
 * `guidanceConcentrationV1Simplified`).
 *
 * Codebase convention: the buff clears at the start of the
 * CASTER's next turn (mirror Blade Ward / Shillelagh / True Strike
 * / Resistance). PHB p.248 canonically says concentration up to
 * 1 minute, but v1 simplifies this to 1 round to avoid the need
 * for a persistent-buff subsystem.
 *
 * Note: canonically, the buff is consumed by the first ability
 * check (one-shot), so cleanup is a safety net — if the caster
 * makes no ability check on their next turn, the buff expires at
 * the start of that next turn via this cleanup. rollAbilityCheck
 * (in utils.ts, implemented in Session 14) is the consuming
 * choke point; this cleanup is the safety net.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._guidanceDieBonusNextAbilityCheck !== undefined) {
    delete combatant._guidanceDieBonusNextAbilityCheck;
  }
}
