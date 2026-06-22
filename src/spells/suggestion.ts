// ============================================================
// Suggestion — PHB p.279
//
// 2nd-level enchantment, action, range 30 ft, concentration (8 hr in canon;
// v1: 1 min simplification — combat-relevant duration only).
// Components: V, M (a snake's tongue and either a bit of honeycomb or
//             a drop of sweet oil).
//
// Effect: You suggest a course of activity (limited to a sentence or two)
//         and magically influence a creature you can see within range that
//         can hear and understand you. The target must make a Wisdom saving
//         throw. On a failed save, it pursues the course of action you
//         described to the best of its ability. The suggested course of
//         action can be for any duration, but the spell ends if the
//         suggested activity is completed. If you or any of your companions
//         damage the creature, the spell ends.
//
// Upcast: — (no At Higher Levels entry).
//
// v2: Suggestion effect type implemented via `effectType: 'suggestion'`
//   (Session 28 engine mechanism). The target is charmed AND has
//   disadvantage on their own attack rolls — matching PHB p.281:
//   "it pursues the course of action you described" (interpreted as
//   the target won't fight effectively). The `suggestion` effect type
//   auto-applies charmed condition + grantSelf disadvantage on attack
//   rolls (handled in applySpellEffect / _undoEffect in spell_effects.ts).
//   Previous v1 simplified to `condition_apply:charmed` only (no combat
//   penalty — charmed alone doesn't hinder attacks in 5e).
//   Documented via `suggestionBehaviourV2Implemented`.
//
// v1 simplifications still pending:
//   - Duration: canon 8 hr concentration → v1: 1 min combat duration
//     (suggestionDurationV1Simplified: true).
//   - Command subsystem: NOT modelled (engine has no mechanism to
//     override AI — would require a "suggested action" hook in planTurn).
//     (suggestionCommandSubystemV1Implemented: false).
//   - Creature-type restriction: NONE in canon (Suggestion works on any
//     creature that can hear and understand you). v1 does NOT verify
//     language comprehension (parser tech debt — TG-004).
//   - Damage-end: NOT modelled (no per-action damage-end hook).
//   - Upcast: — (no At Higher Levels entry).
//   - Concentration enforcement: NOT enforced (TG-002).
//
// Spell module pattern (mirrors crown_of_madness.ts save-or-charmed pattern
// but WITHOUT the humanoid-type check):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Suggestion',
  level: 2,
  school: 'enchantment',
  rangeFt: 30,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  suggestionBehaviourV2Implemented: true,                  // suggestion effect type (charmed + disadv on attacks)
  suggestionCommandSubystemV1Implemented: false,            // command-subsystem NOT modelled
  suggestionDurationV1Simplified: true,                     // canon 8 hr → v1 1 min combat duration
  suggestionUpcastV1Implemented: false,                     // no At Higher Levels entry — single target
  suggestionConcentrationEnforcementV1Implemented: true,   // TG-002 DONE (Session 34)
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

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Suggestion (a living enemy within 30 ft,
 * not already charmed or Suggested by this caster), or null when the spell
 * should not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 30 ft — charming
 * the biggest attacker removes them from the fight (v1: charmed condition
 * only — no command-subsystem yet).
 *
 * Preconditions:
 *   - Caster has 'Suggestion' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 30 ft
 *
 * Note: Suggestion IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 *
 * Note: v1 does NOT verify creature type or language comprehension (canon
 * requires the target to "hear and understand you"). All living enemies
 * within 30 ft are valid targets.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Suggestion')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip if already charmed by any source — Suggestion doesn't stack
    // (a creature can be charmed by multiple casters, but v1 doesn't track
    // per-caster charm — re-cast would only refresh the duration, which is
    // wasteful).
    if (c.conditions.has('charmed')) continue;

    // Skip if already Suggested by this caster (re-cast would only refresh
    // the duration — wasteful in v1).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Suggestion'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Suggestion:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Suggestion.
 *  4. Roll the target's WIS save vs the caster's saveDC.
 *  5. On fail: apply condition_apply:charmed effect on the target.
 *     - The effect has sourceIsConcentration: true (removed when the
 *       caster's concentration breaks).
 *  6. On success: log the save, no effect applied.
 *
 * v1 simplifications: command-subsystem NOT modelled (charmed condition
 * only); damage-end NOT modelled; duration simplified (canon 8 hr → v1 1 min);
 * concentration NOT enforced (TG-002). The charmed condition persists for
 * the entire combat (or until concentration breaks).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Suggestion');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Suggestion');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Suggestion at ${target.name}! (DC ${saveDC} WIS)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Suggestion (rolled ${save.total})`,
    target.id, save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Suggestion — not charmed!`,
      target.id,
    );
    return;
  }

  // Apply suggestion effect (v2: charmed + disadv on attack rolls —
  // the command-subsystem is NOT modelled, but the target won't fight effectively).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Suggestion',
    effectType: 'suggestion',
    payload: {},
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is under SUGGESTION! (charmed + disadv on attacks)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
