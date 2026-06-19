// ============================================================
// Friends — PHB p.244
// Level 0 enchantment cantrip
//
// Casting time: action
// Range: Self
// Components: S + M  (CANON — 5etools JSON: {"s":true,
//   "m":"a small amount of makeup applied to the face as this
//   spell is cast"}, NO V)
// Duration: 1 minute (concentration)
// Effect: For the duration, you have advantage on all Charisma
//   checks directed at one creature of your choice that isn't
//   hostile toward you. When the spell ends, the creature
//   realizes that you used magic to influence its mood and
//   becomes hostile toward you. A creature prone to violence
//   might attack you. Another creature might seek retribution
//   in other ways (at the DM's discretion), depending on the
//   nature of your interaction with it.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — 1-round non-concentration
// self-buff, advantage on next CHA check regardless of target;
// mirrors True Strike's advantage on next attack roll, but for
// CHA checks instead of ATTACK rolls):
// ────────────────────────────────────────────────────────────
// Friends is the SIXTH self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first five are Blade Ward, Shillelagh, True Strike,
// Resistance, Guidance). Like them, it sets a scratch flag on
// the caster and is cleaned up by resetBudget(). Unlike True
// Strike (whose flag is read by resolveAttack's attack-roll
// branch), Friends' flag is read by the FUTURE rollAbilityCheck()
// choke point — which does NOT exist yet in the engine. v1 sets
// the flag on cast but does not consume it (documented via the
// metadata flag `friendsAbilityCheckIntegrationV1Implemented:
// false`). The flag still clears at the start of the caster's
// NEXT turn via cleanup() called from resetBudget() (v1 1-round
// simplification).
//
// v1 simplification: PHB p.244 canonically requires concentration,
// lasts up to 1 minute, and is "directed at one creature of your
// choice that isn't hostile toward you". v1 treats Friends as a
// 1-round, non-concentration, target-agnostic buff (the caster
// gains advantage on the next CHA check regardless of target —
// sidesteps the engine complexity of tracking which creature
// Friends was cast on). Documented via the metadata flags
// `friendsConcentrationV1Simplified: true`,
// `friendsTargetAgnosticV1Simplified: true`, and
// `friendsHostilityBacklashV1Implemented: false` (canon: "the
// creature realizes that you used magic to influence its mood and
// becomes hostile toward you" — v1 skips this backlash entirely).
//
// Mirrors True Strike (PHB p.284) — same architecture, same
// one-shot consume semantics, but for CHA CHECKS instead of
// ATTACK rolls:
//   True Strike: _trueStrikeAdvNextAttack   = true  [attack advantage, consumed by resolveAttack]
//   Friends:     _friendsAdvNextChaCheck    = true  [CHA-check advantage, consumed by future rollAbilityCheck]
//
// Advantage integration (FUTURE — rollAbilityCheck in utils.ts):
//   - When `combatant._friendsAdvNextChaCheck === true`, the
//     future rollAbilityCheck() will fold this into the advantage
//     boolean for Charisma checks (mirror True Strike's attack-
//     roll advantage integration, but for CHA checks instead of
//     ATTACK rolls), then CONSUME the flag (set to false) after
//     the CHA check resolves — one-shot.
//   - v1 does NOT implement this integration (no rollAbilityCheck
//     choke point exists yet — forward-compat TODO via the metadata
//     flag `friendsAbilityCheckIntegrationV1Implemented: false`).
//
// Routing (per zHANDOVER-SESSION-11):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Friends's Action (no target — self-buff v1; the target-
//     agnostic simplification means the buff applies to the next
//     CHA check regardless of target).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Blade Ward / Shillelagh / True Strike /
//     Resistance / Guidance's routing exactly.
//
// Registered in CANTRIP_SELF_EFFECTS (non-attack self-buff
// registry, alongside Blade Ward, Shillelagh, True Strike,
// Resistance, Guidance).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Friends',
  level: 0,
  school: 'enchantment',
  /** Range: Self (PHB p.244 — the caster targets themselves with the CHA-check advantage buff). */
  rangeFt: 0,
  /**
   * PHB p.244 canonically requires concentration, up to 1 minute.
   * v1 simplification: treat as a 1-round, NON-concentration buff
   * (clears at start of caster's next turn). See module header.
   */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Friends is a pure CHA-check-advantage self-buff. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the advantage buff is flat). */
  scales: false as const,
  /**
   * Components: S + M (CANON — 5etools JSON: {"s":true,
   * "m":"a small amount of makeup applied to the face as this
   * spell is cast"}, NO V). Cross-checked against the 5etools
   * spell-cache JSON per the Session 9 protocol — the handover
   * also listed S+M (makeup, no V), canon confirmed.
   */
  components: { v: false, s: true, m: true } as const,
  /** Self-buff flag — read by the AI/planner to know this is a non-attack cantrip. */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.244 canonically requires
   * concentration, up to 1 minute. v1 treats Friends as a
   * 1-round, non-concentration buff (clears at start of caster's
   * next turn). Future work: a persistent-buff subsystem that
   * tracks 1-minute durations and concentration.
   */
  friendsConcentrationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.244 canonically grants advantage
   * on CHA checks directed at ONE creature of the caster's choice
   * that isn't hostile. v1 is target-agnostic — the buff applies
   * to the caster's NEXT CHA check regardless of target. Future
   * work: a "Friends mark" on the target, checked by the future
   * rollAbilityCheck's advantage boolean.
   */
  friendsTargetAgnosticV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.244 canonically imposes a
   * hostility backlash when the spell ends ("the creature realizes
   * that you used magic to influence its mood and becomes hostile
   * toward you"). v1 skips this backlash entirely (no hostility
   * tracking subsystem). Future work: a post-buff-backlash hook
   * that flips the target's faction attitude toward the caster
   * when the buff expires.
   */
  friendsHostilityBacklashV1Implemented: false as const,
  /**
   * v1 simplification flag: the engine currently has NO
   * rollAbilityCheck() choke point in utils.ts. v1 sets the
   * `_friendsAdvNextChaCheck` flag on cast but does not consume
   * it (the flag is cleared at the start of the caster's NEXT
   * turn via cleanup() called from resetBudget — v1 1-round
   * simplification). Future work: add rollAbilityCheck() to
   * utils.ts (mirror rollSave's architecture — fold in
   * `_friendsAdvNextChaCheck` for CHA checks and consume on the
   * next CHA check, mirror True Strike's resolveAttack advantage
   * integration but for ability checks).
   */
  friendsAbilityCheckIntegrationV1Implemented: false as const,
  /**
   * Rider restriction: NONE — Friends's advantage applies to ANY
   * Charisma check (no sub-restriction like "ability checks
   * against a specific target" in v1's target-agnostic mode).
   * Mirror True Strike's `riderAttackTypes: ['melee', 'ranged',
   * 'spell']` pattern — Friends applies to ALL CHA checks
   * (Persuasion, Deception, Intimidation, Performance, generic
   * CHA checks).
   */
  riderCheckAbility: 'cha' as const,
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
 * Apply Friends's self-buff: set the caster's
 * `_friendsAdvNextChaCheck` flag. Called via resolveCantripAction()
 * from CANTRIP_SELF_EFFECTS in cantrip_effects.ts, which
 * executePlannedAction consults for non-attack cantrips (routing
 * them away from resolveAttack).
 *
 * While `_friendsAdvNextChaCheck === true`, the FUTURE
 * rollAbilityCheck() choke point in utils.ts (NOT YET IMPLEMENTED
 * — forward-compat TODO) will fold this into the advantage boolean
 * for Charisma checks (mirror True Strike's attack-roll advantage
 * integration, but for CHA checks instead of ATTACK rolls), then
 * CONSUME the flag (set to false) after the CHA check resolves —
 * one-shot (PHB p.244: "advantage on all Charisma checks directed
 * at one creature of your choice that isn't hostile toward you" —
 * v1 simplifies to the NEXT CHA check regardless of target). v1
 * does NOT consume the flag (no rollAbilityCheck choke point
 * exists yet) — the flag still clears at the start of the caster's
 * NEXT turn via cleanup() called from resetBudget (v1 1-round
 * simplification).
 *
 * @returns true if the buff was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  const alreadyActive = caster._friendsAdvNextChaCheck === true;
  caster._friendsAdvNextChaCheck = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Friends — ${alreadyActive ? 'already active' : 'gains advantage on next Charisma check (v1: 1-round, target-agnostic; CHA-check integration not yet implemented)'}!`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the
 * `_friendsAdvNextChaCheck` flag so the buff expires (v1
 * simplification: 1-round duration per the metadata flag
 * `friendsConcentrationV1Simplified`).
 *
 * Codebase convention: the buff clears at the start of the
 * CASTER's next turn (mirror Blade Ward / Shillelagh / True Strike
 * / Resistance / Guidance). PHB p.244 canonically says
 * concentration up to 1 minute, but v1 simplifies this to 1 round
 * to avoid the need for a persistent-buff subsystem.
 *
 * Note: canonically, the buff is consumed by the first CHA check
 * (one-shot), so cleanup is a safety net — if the caster makes no
 * CHA check on their next turn (and the future rollAbilityCheck
 * choke point is implemented), the buff expires at the start of
 * the turn after that. In v1 (no rollAbilityCheck integration),
 * cleanup is the ONLY mechanism that clears the flag (the flag is
 * never consumed because the choke point doesn't exist yet).
 *
 * v1 simplification: PHB p.244 canonically imposes a hostility
 * backlash when the spell ends ("the creature realizes that you
 * used magic to influence its mood and becomes hostile toward
 * you"). v1 skips this backlash (documented via the metadata flag
 * `friendsHostilityBacklashV1Implemented: false`). Future work:
 * a post-buff-backlash hook that flips the target's faction
 * attitude toward the caster when the buff expires.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._friendsAdvNextChaCheck !== undefined) {
    delete combatant._friendsAdvNextChaCheck;
  }
}
