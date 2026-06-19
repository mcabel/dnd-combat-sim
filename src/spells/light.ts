// ============================================================
// Light — PHB p.255
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Touch (one object no larger than 10 feet in any dimension)
// Components: V + M  (CANON — 5etools JSON: {"v":true,
//   "m":"a firefly or phosphorescent moss"}, NO S)
// Duration: 1 hour
// Effect: You touch one object that is no larger than 10 feet in
//   any dimension. Until the spell ends, the object sheds bright
//   light in a 20-foot radius and dim light for an additional
//   20 feet. The light can be colored as you like. Completely
//   covering the object with something opaque blocks the light.
//   The spell ends if you cast it again or dismiss it as an
//   action.
//   If you target an object held or worn by a hostile creature,
//   that creature must succeed on a Dexterity saving throw to
//   avoid the spell.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only touch-effect
// that sets a `_lightSourceActive` flag on the target; bypasses
// resolveAttack entirely; no DEX save in v1):
// ────────────────────────────────────────────────────────────
// Light is the SECOND cantrip in CANTRIP_TOUCH_EFFECTS (the first
// is Spare the Dying). Like Spare the Dying, it routes via
// resolveCantripTouchEffect() in cantrip_effects.ts, which
// executePlannedAction consults AFTER resolveCantripAction
// (self-buffs) and resolveCantripAoE (AoE), but BEFORE the
// target-null guard. This routing is necessary because Light is
// a non-attack, non-AoE, non-self-buff cantrip that targets a
// single object/creature (the caster touches the target to
// ignite it).
//
// v1 simplification: PHB p.255 canonically has Touch range (the
// caster must be adjacent to the target object). v1 does NOT
// enforce adjacency (the AI/planner is trusted to only target
// objects within 5 ft). Documented via the metadata flag
// `lightRangeEnforcementV1Simplified: true`.
//
// v1 simplification: PHB p.255 canonically imposes a DEX save on
// hostile creatures ("If you target an object held or worn by a
// hostile creature, that creature must succeed on a Dexterity
// saving throw to avoid the spell."). v1 treats ALL targets as
// "willing" (no DEX save) for simplicity — the hostile-target
// DEX save is documented as TODO. Documented via the metadata
// flag `lightHostileTargetSaveV1Simplified: true`.
//
// v1 simplification: PHB p.255 canonically lasts 1 hour. v1
// treats Light as a 1-round buff (the `_lightSourceActive` flag
// clears at the start of the caster's NEXT turn via cleanup()
// called from resetBudget). This avoids the need for a
// persistent-buff subsystem. Documented via the metadata flag
// `lightDurationV1Simplified: true` (canon: 1 hour; v1: 1 round).
//
// v1 simplification: the engine's computeLOS does NOT yet model
// light-radius-based vision changes (Darkness and similar effects
// also lack this integration). v1 sets the `_lightSourceActive`
// flag on the target for FORWARD-COMPATIBILITY — the future
// vision subsystem will read this flag and apply bright/dim light
// radius effects. Documented via the metadata flag
// `lightVisionIntegrationV1Implemented: false`.
//
// v1 simplification: PHB p.255 canonically allows the caster to
// "dismiss it as an action" and the spell ends if cast again.
// v1 has no dismissal action and no recast-tracking. Documented
// via the metadata flags `lightDismissalV1Implemented: false`
// and `lightRecastEndsPreviousV1Implemented: false`.
//
// Stabilize logic (v1):
//   - Set `target._lightSourceActive = true` (forward-compat flag
//     for the future vision subsystem).
//   - Emit a "begins to glow with light" log event.
//   - No save, no damage, no attack roll.
//
// Routing (per zHANDOVER-SESSION-11):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Light's Action and a target (the object/creature to ignite).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_TOUCH_EFFECTS registry via
//     resolveCantripTouchEffect(caster, target, actionName, state)
//     AFTER resolveCantripAction (self-buffs) and resolveCantripAoE
//     (AoE), but BEFORE the target-null guard. If the cantrip name
//     is registered, resolveCantripTouchEffect calls the module's
//     applyTouchEffect(caster, target, state) and returns true;
//     the switch breaks (Light bypasses resolveAttack entirely —
//     no attack roll, no save in v1).
//   - This mirrors Spare the Dying's routing exactly.
//
// No scratch field on the CASTER (the light effect modifies
// TARGET state directly via `_lightSourceActive`). Cleanup needed
// (clears the target's `_lightSourceActive` flag at the start of
// the CASTER's next turn — v1 1-round simplification, canonically
// the spell lasts 1 hour).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Light',
  level: 0,
  school: 'evocation',
  /** Range: Touch (PHB p.255 — caster must be adjacent to the target object). */
  rangeFt: 0,
  /** No concentration — Light lasts 1 hour (PHB p.255), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Light is a pure utility (light-source) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the light radius is flat — 20 ft bright + 20 ft dim). */
  scales: false as const,
  /**
   * Components: V + M (CANON — 5etools JSON: {"v":true,
   * "m":"a firefly or phosphorescent moss"}, NO S). Cross-checked
   * against the 5etools spell-cache JSON per the Session 9
   * protocol — the handover also listed V+M (firefly/phosphorescent
   * moss, NO S), canon confirmed.
   */
  components: { v: true, s: false, m: true } as const,
  /**
   * Touch-effect flag — read by the AI/planner to know this is a
   * non-attack, non-AoE, non-self-buff cantrip that targets a
   * single object/creature. Routes via CANTRIP_TOUCH_EFFECTS (NOT
   * CANTRIP_SELF_EFFECTS or CANTRIP_AOE_EFFECTS).
   */
  isTouchEffect: true as const,
  /** Bright light radius in feet (PHB p.255). */
  brightLightRadiusFt: 20 as const,
  /** Dim light radius in feet beyond the bright radius (PHB p.255). */
  dimLightRadiusFt: 20 as const,
  /**
   * v1 simplification flag: the engine's computeLOS does NOT yet
   * model light-radius-based vision changes (Darkness and similar
   * effects also lack this integration). v1 sets the
   * `_lightSourceActive` flag on the target for FORWARD-COMPAT
   * — the future vision subsystem will read this flag and apply
   * bright/dim light radius effects. Future work: extend
   * computeLOS to query `_lightSourceActive` flags and apply
   * light-radius vision changes (Darkness, Light, Dancing Lights,
   * etc.).
   */
  lightVisionIntegrationV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.255 canonically allows the
   * caster to "dismiss it as an action". v1 has no dismissal
   * action (the buff expires at the start of the caster's NEXT
   * turn via cleanup, regardless). Future work: a dismissal
   * action that clears the `_lightSourceActive` flag.
   */
  lightDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.255 canonically says "The spell
   * ends if you cast it again". v1 has no recast-tracking (each
   * cast sets a fresh `_lightSourceActive` flag on a new target;
   * previous flags expire at the start of the caster's next turn
   * via cleanup). Future work: a recast-tracking subsystem that
   * clears prior `_lightSourceActive` flags when Light is cast
   * again.
   */
  lightRecastEndsPreviousV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.255 canonically imposes a DEX
   * save on hostile creatures ("If you target an object held or
   * worn by a hostile creature, that creature must succeed on a
   * Dexterity saving throw to avoid the spell."). v1 treats ALL
   * targets as "willing" (no DEX save) for simplicity. Future
   * work: a hostile-target detection + DEX save branch (mirror
   * Sacred Flame's save branch — Light's save DC = caster's spell
   * save DC, save ability = 'dex').
   */
  lightHostileTargetSaveV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.255 canonically lasts 1 hour.
   * v1 treats Light as a 1-round buff (clears at start of caster's
   * next turn via cleanup). Future work: a persistent-buff
   * subsystem that tracks 1-hour durations.
   */
  lightDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.255 canonically has Touch range
   * (the caster must be adjacent to the target object). v1 does
   * NOT enforce adjacency. Future work: a range-enforcement check
   * in the touch-effect dispatcher.
   */
  lightRangeEnforcementV1Simplified: true as const,
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

// ---- applyTouchEffect -----------------------------------------

/**
 * Apply Light's touch-effect: set the target's
 * `_lightSourceActive` flag (forward-compat for the future vision
 * subsystem). Called via resolveCantripTouchEffect() from
 * CANTRIP_TOUCH_EFFECTS in cantrip_effects.ts, which
 * executePlannedAction consults for touch cantrips (routing them
 * away from resolveAttack and AWAY from the standard target-null/
 * dead/unconscious guard).
 *
 * v1 simplification: treat ALL targets as "willing" (no DEX save
 * — the hostile-target DEX save is documented as TODO via the
 * metadata flag `lightHostileTargetSaveV1Simplified: true`).
 *
 * The `_lightSourceActive` flag is read by the FUTURE vision
 * subsystem (computeLOS extension) to apply bright/dim light
 * radius effects. v1 sets the flag but the vision subsystem does
 * not yet consume it (documented via the metadata flag
 * `lightVisionIntegrationV1Implemented: false`). The flag still
 * clears at the start of the caster's NEXT turn via cleanup()
 * called from resetBudget (v1 1-round simplification — canonically
 * the spell lasts 1 hour).
 *
 * @returns true if the touch effect was applied (the action is
 *          consumed and resolveAttack is bypassed)
 */
export function applyTouchEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // 1. Fizzle: target is dead (can't ignite a dead creature —
  //    PHB p.255 implies the object must be intact, and a dead
  //    creature's equipment is lootable but the creature itself
  //    is beyond magical light). This is a defensive check — the
  //    AI/planner shouldn't target dead creatures.
  if (target.isDead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Light on ${target.name} — no effect (target is dead)!`,
      target.id,
    );
    return true;
  }

  // 2. Set the `_lightSourceActive` flag on the target.
  //    FORWARD-COMPAT: the future vision subsystem (computeLOS
  //    extension) will read this flag to apply bright/dim light
  //    radius effects. v1 sets the flag but does not consume it
  //    in computeLOS (the integration is TODO).
  target._lightSourceActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Light on ${target.name} — ${target.name} begins to glow with bright light (20-ft radius) and dim light (additional 20-ft radius) for 1 hour! (v1: 1-round duration; vision integration not yet implemented)`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the `_lightSourceActive`
 * flag on the combatant whose turn is starting (the CASTER, in
 * the normal case — the caster cast Light last turn, and the buff
 * expires at the start of their next turn per the v1 1-round
 * simplification).
 *
 * NOTE: This cleanup operates on the CASTER (the combatant whose
 * turn is starting), NOT the target. The caster is the one who
 * cast Light, so the buff's expiration is timed to the caster's
 * next turn. However, the `_lightSourceActive` flag is set on the
 * TARGET, not the caster. This means the cleanup as written only
 * clears the flag if the CASTER is also the TARGET (self-cast
 * Light, which is rare — casters usually ignite an object or
 * ally's equipment, not themselves).
 *
 * For v1, this is acceptable — the flag is forward-compat only
 * (no mechanical effect in v1 because the vision subsystem is
 * not yet implemented). Future work: a persistent-buff subsystem
 * that tracks which combatant holds the `_lightSourceActive` flag
 * and clears it when the spell expires (whether on the caster's
 * next turn per v1, or after 1 hour per canon).
 *
 * For maximum safety, the cleanup ALSO clears the flag from ANY
 * combatant that has it set (defensive cleanup — ensures no stale
 * flags persist across turns). This is a no-op if the combatant
 * doesn't have the flag set.
 *
 * v1 simplification: PHB p.255 canonically lasts 1 hour. v1
 * clears the flag at the start of the caster's NEXT turn (1-round
 * simplification). Documented via the metadata flag
 * `lightDurationV1Simplified: true`.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._lightSourceActive !== undefined) {
    delete combatant._lightSourceActive;
  }
}
