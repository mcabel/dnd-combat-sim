// ============================================================
// Resistance — PHB p.272
// Level 0 abjuration cantrip
//
// Casting time: action
// Range: Touch (one willing creature — can target self or ally)
// Components: V + S + M (a miniature cloak)
// Duration: 1 minute (concentration)
// Effect: You touch one willing creature. Once before the spell
//   ends, the target can roll a d4 and add the number rolled to
//   one saving throw of its choice. It can roll the die before
//   or after making the saving throw. The spell then ends.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — 1-round non-concentration
// self-buff, +1d4 to next save; mirrors Mind Sliver's -1d4):
// ────────────────────────────────────────────────────────────
// Resistance is the FOURTH self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first three are Blade Ward, Shillelagh, True Strike). Like
// them, it sets a scratch flag on the target and is cleaned up by
// resetBudget(). Unlike the others, Resistance's flag is read by
// rollSave() (in utils.ts) — the save-bonus analogue of Mind
// Sliver's save-penalty integration.
//
// v1 simplification: PHB p.272 canonically requires concentration,
// lasts up to 1 minute, and can target ANY willing creature (touch
// range — self OR ally). v1 treats Resistance as a 1-round,
// non-concentration SELF-buff (the caster targets themselves; the
// touch-ally mode is documented as TODO). Documented via the
// metadata flags `resistanceConcentrationV1Simplified: true` and
// `resistanceTouchAllyV1Simplified: true`.
//
// Mirrors Mind Sliver (TCE p.108) — same architecture, opposite
// sign:
//   Mind Sliver: target._mindSliverDiePenaltyNextSave = 4 (d4)
//                → rollSave() SUBTRACTS rollDie(4) from the save
//                  total, then consumes the flag.
//                → set on the TARGET (debuff on an enemy).
//   Resistance:  target._resistanceDieBonusNextSave = 4 (d4)
//                → rollSave() ADDS rollDie(4) to the save total,
//                  then consumes the flag.
//                → set on the CASTER (buff on self/ally).
//
// The flag is stored as the die size (4 = d4) so the system is
// extensible to other die bonuses (e.g. a hypothetical "Greater
// Resistance" cantrip that adds 1d6 — set the flag to 6).
//
// Save-bonus integration (rollSave in utils.ts):
//   - When `combatant._resistanceDieBonusNextSave` is set,
//     rollSave() rolls rollDie(value) and ADDS the result to the
//     save total (mirror Mind Sliver's subtract logic).
//   - Consume (set to undefined) after the save resolves — one-shot
//     (PHB p.272: "Once before the spell ends").
//
// Routing (per zHANDOVER-SESSION-10):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Resistance's Action (no target — self-buff v1; the
//     touch-ally mode is TODO).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Blade Ward / Shillelagh / True Strike's
//     routing exactly.
//
// Registered in CANTRIP_SELF_EFFECTS (non-attack self-buff
// registry, alongside Blade Ward, Shillelagh, True Strike).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Resistance',
  level: 0,
  school: 'abjuration',
  /** Range: Touch (PHB p.272 — can target self or ally). */
  rangeFt: 0,
  /**
   * PHB p.272 canonically requires concentration, up to 1 minute.
   * v1 simplification: treat as a 1-round, NON-concentration buff
   * (clears at start of caster's next turn). See module header.
   */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Resistance is a pure save-bonus self-buff. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the +1d4 save bonus is flat). */
  scales: false as const,
  /** Components: V + S + M (a miniature cloak). */
  components: { v: true, s: true, m: true } as const,
  /** Self-buff flag — read by the AI/planner to know this is a non-attack cantrip. */
  isSelfBuff: true as const,
  /**
   * Rider die size: the target adds rollDie(riderDieSides) to its
   * next save. Stored on the target as
   * `_resistanceDieBonusNextSave = riderDieSides`. Mirror Mind
   * Sliver's `riderDieSides: 4` metadata pattern.
   */
  riderDieSides: 4 as const,
  /**
   * v1 simplification flag: PHB p.272 canonically requires
   * concentration, up to 1 minute. v1 treats Resistance as a
   * 1-round, non-concentration buff (clears at start of caster's
   * next turn). Future work: a persistent-buff subsystem that
   * tracks 1-minute durations and concentration.
   */
  resistanceConcentrationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.272 canonically allows targeting
   * ANY willing creature (touch range — self OR ally). v1 treats
   * Resistance as a SELF-buff only (the caster targets themselves).
   * Future work: a touch-ally targeting mode that sets the flag on
   * a different combatant.
   */
  resistanceTouchAllyV1Simplified: true as const,
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
 * Apply Resistance's self-buff: set the caster's
 * `_resistanceDieBonusNextSave` flag to 4 (d4). Called via
 * resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * While `_resistanceDieBonusNextSave` is set, rollSave() in
 * utils.ts rolls rollDie(value) (a d4) and ADDS the result to the
 * save total (mirror Mind Sliver's subtract-1d4 logic but with
 * the opposite sign), then CONSUMES the flag (sets to undefined)
 * after the save resolves — success or failure. The bonus applies
 * to ANY saving throw the caster makes while the flag is set
 * (str/dex/con/int/wis/cha). If the caster makes no save before
 * its next turn starts, cleanup() (called from resetBudget) clears
 * the flag (v1 1-round simplification).
 *
 * @returns true if the buff was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  const alreadyActive = caster._resistanceDieBonusNextSave !== undefined;
  caster._resistanceDieBonusNextSave = metadata.riderDieSides;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Resistance — ${alreadyActive ? 'already active' : `gains +1d4 to next saving throw (v1: 1-round, self-only)`}!`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the
 * `_resistanceDieBonusNextSave` flag so the buff expires (v1
 * simplification: 1-round duration per the metadata flag
 * `resistanceConcentrationV1Simplified`).
 *
 * Codebase convention: the buff clears at the start of the
 * CASTER's next turn (mirror Blade Ward / Shillelagh / True Strike).
 * PHB p.272 canonically says concentration up to 1 minute, but v1
 * simplifies this to 1 round to avoid the need for a persistent-
 * buff subsystem.
 *
 * Note: canonically, the buff is consumed by the first save
 * (one-shot), so cleanup is a safety net — if the caster makes
 * no save on their next turn, the buff expires at the start of
 * the turn after that.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._resistanceDieBonusNextSave !== undefined) {
    delete combatant._resistanceDieBonusNextSave;
  }
}
