// ============================================================
// Mass Suggestion — PHB p.258
//
// 6th-level enchantment, action, range 60 ft, NO concentration (24 hr).
// Components: V, M (a snake's tongue and a honeycomb).
//
// Effect: You suggest a course of activity (limited to a sentence or two)
//         and magically influence up to twelve creatures of your choice
//         that you can see within range and that can hear and understand
//         you. Creatures that can't be charmed are immune. Each target
//         must make a Wisdom saving throw. On a failed save, it pursues
//         the course of action you described.
//
// Upcast: +1 target per slot-level above 6th (not modelled in v1).
//
// v1 simplifications:
//   - Suggestion effect: canon "pursues the course of action you described"
//     is modelled as `suggestion` effect type: charmed + disadvantage on
//     the target's own attack rolls ("Don't fight" — the default suggestion
//     that removes targets as combat threats). This is more canon-faithful
//     than just charmed (which only prevents attacking the caster).
//     Documented via `massSuggestionBehaviourV2Implemented`.
//   - Target cap: canon "up to twelve". v1 caps at 12 highest-threat
//     enemies within 60 ft. Upcast +1/slot-level NOT modelled.
//   - Duration: canon 24 hr (no concentration). Tracked via
//     sourceTurnExpires (Session 82, RFC-COMBINING-EFFECTS Phase 2):
//     the suggestion effect gets appliedTurn + sourceTurnExpires =
//     round + 14400 (24 hr = 14400 rounds), so reevaluateEffects
//     removes it once the 24-hr cap elapses. NOT concentration
//     (sourceIsConcentration: false). (Combat rarely reaches 24 h,
//     but the value is set for correctness / long-running sim scenarios.)
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 (square approx).
//   - "Can hear and understand you" / language restriction: NOT enforced.
//   - Charm-immunity (constructs/undead): NOT enforced (no creature-type tag).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed AoE (no conc, 12-cap).
// Removed from `_generic_registry.ts`; routed via `case 'massSuggestion':`
// in combat.ts and a planner branch in planner.ts. Mirrors Sunburst
// (radius AoE save + condition) but no damage, no concentration, 12-cap.
//
// Spell module pattern (radius AoE save + condition, 12-cap, no conc):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (no concentration; charmed persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mass Suggestion',
  level: 6,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.258: 60 ft
  maxTargets: 12,                // PHB p.258: up to 12
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  massSuggestionBehaviourV2Implemented: true,              // suggestion → charmed + disadv on attacks ("Don't fight")
  massSuggestionDurationV1Simplified: false,                // Session 82: 24-hr tracked via sourceTurnExpires
  massSuggestionDurationV1Implemented: true,                // Session 82: sourceTurnExpires = round + 14400
  massSuggestionUpcastV1Implemented: false,                 // +1 target/slot-level NOT modelled
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
 * Returns up to 12 highest-threat enemies within 60 ft of the caster, or
 * null when the spell should not be cast.
 *
 * Target selection:
 *   1. Collect all living enemies within 60 ft (chebyshev3D * 5).
 *   2. Sort by maxHP descending (highest-threat first), then closest.
 *   3. Take up to `metadata.maxTargets` (12), skipping those already
 *      charmed/incapacitated.
 *
 * Preconditions:
 *   - Caster has 'Mass Suggestion' in their actions
 *   - Caster has at least one 6th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Mass Suggestion is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on conc.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Mass Suggestion')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.conditions.has('charmed') || e.conditions.has('incapacitated')) continue;
    if (e.activeEffects.some(x => x.casterId === caster.id && x.spellName === 'Mass Suggestion')) continue;
    candidates.push({ c: e, threat: e.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  const picked = candidates.slice(0, metadata.maxTargets).map(x => x.c);
  return picked.length >= 1 ? picked : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Mass Suggestion:
 *  1. Consume a 6th-level spell slot.
 *  2. For each target: roll WIS save; on fail apply `suggestion` effect
 *     (charmed + disadvantage on attack rolls — "Don't fight"). NOT conc.
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Warlock / Wizard)
 * @param targets Candidates from shouldCast (up to 12 enemies in 60 ft)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Mass Suggestion');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mass Suggestion! (DC ${saveDC} WIS, suggestion on fail, ${targets.length} target${targets.length !== 1 ? 's' : ''})`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Mass Suggestion (rolled ${save.total})${save.success ? '' : ' + SUGGESTION (charmed + disadv on attacks)'}`,
      target.id, save.roll,
    );

    if (!save.success && !target.conditions.has('charmed')) {
      const round = state.battlefield.round;
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Mass Suggestion',
        effectType: 'suggestion',
        payload: {},
        sourceIsConcentration: false,   // PHB p.258: NOT concentration (24-hr)
        appliedTurn: round,
        sourceTurnExpires: round + 14400,  // 24 hr = 14400 rounds (PHB p.258)
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is under Mass Suggestion! (charmed + disadv on attacks — "Don't fight")`,
        target.id,
      );
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; charmed persists for v1 combat.
}
